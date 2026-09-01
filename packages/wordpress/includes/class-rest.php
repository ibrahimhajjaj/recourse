<?php
/**
 * The chat endpoint.
 *
 * `/wp-json/recourse/v1/chat`, answering in the same event-stream protocol the
 * widget already speaks, so the same widget build serves a WordPress install
 * and a Node one.
 *
 * **Why there is no nonce on this route.** A nonce would be the reflex, and on
 * a public chat endpoint it is worse than nothing. It is tied to the session
 * cookie, and an anonymous visitor has none, so every anonymous visitor shares
 * the same value, which is not a credential. Worse, every shop runs full-page
 * caching, so the nonce embedded in a cached page is stale by the time anybody
 * reads it, and the chat breaks for exactly the sites that have the most
 * traffic. The controls that do work here are the rate limit and the fact that
 * the endpoint can only ever read published content.
 *
 * Admin routes are a different matter, and those do check a nonce and a
 * capability.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Registers and serves the routes.
 */
class Rest {

	/**
	 * Namespace for every route here.
	 */
	const NAMESPACE_V1 = 'recourse/v1';

	/**
	 * Messages one visitor may send per window.
	 */
	const RATE_LIMIT = 20;

	/**
	 * The window, in seconds.
	 */
	const RATE_WINDOW = 300;

	/**
	 * Longest question accepted, in characters.
	 */
	const MAX_MESSAGE = 4000;

	/**
	 * Turns of history kept.
	 */
	const MAX_HISTORY = 12;

	/**
	 * Hooks the routes up.
	 *
	 * @return void
	 */
	public static function register() {
		register_rest_route(
			self::NAMESPACE_V1,
			'/chat',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'chat' ),
				// Public on purpose: this is the visitor-facing endpoint, and
				// everything it can reach is content the site already
				// publishes.
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Answers a question.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function chat( $request ) {
		$caller = self::caller();

		if ( self::over_limit( $caller ) ) {
			return new \WP_REST_Response( array( 'error' => __( 'Too many messages just now.', 'recourse' ) ), 429 );
		}

		$messages = self::messages( $request->get_param( 'messages' ) );

		if ( empty( $messages ) ) {
			return new \WP_REST_Response( array( 'error' => __( 'No question was sent.', 'recourse' ) ), 400 );
		}

		// Read before anything is spent. A refused turn costs no retrieval and
		// no model call, which is the whole reason this runs first.
		$last = end( $messages );
		if ( is_array( $last ) && isset( $last['content'] ) ) {
			$checked = Safety::check_input( (string) $last['content'] );
			$verdict = Safety::verdict( $checked['signals'] );

			// The message carries on with whatever was taken out of it, so a
			// card number never reaches the model even when the turn is fine.
			$messages[ count( $messages ) - 1 ]['content'] = $checked['text'];

			if ( null !== $verdict && 'flag' !== $verdict['action'] ) {
				do_action( 'recourse_message_refused', $verdict['category'], $verdict['reason'] );

				return self::stream( array(), '', $verdict['message'] );
			}
		}

		$index = Storage::load();

		if ( null === $index ) {
			return self::stream(
				array(),
				__( 'The assistant has not been set up yet. An administrator needs to build the index.', 'recourse' )
			);
		}

		// Screened before anything reads them. An indexed page carrying text
		// written at the assistant reaches the model as evidence otherwise,
		// with the same standing as the shipping policy.
		$matches = Safety::screen( Retriever::retrieve( $index, Prompt::retrieval_query( $messages ) ) );

		// The bare question first, and the previous turn folded in only when
		// that finds nothing. Doing it the other way round drags the old
		// subject into every question that changed it.
		if ( empty( $matches ) ) {
			$contextual = Prompt::contextual_query( $messages );

			if ( null !== $contextual ) {
				$matches = Safety::screen( Retriever::retrieve( $index, $contextual ) );
			}
		}

		$settings = Settings::all();

		$answer = Model::answer(
			Prompt::instructions( $matches, $settings['persona'], ! empty( Actions::all() ) ),
			$messages,
			$settings['model'],
			array(
				'conversation' => sanitize_text_field( (string) $request->get_param( 'conversationId' ) ),
				'caller'       => $caller,
			)
		);

		if ( ! $answer['ok'] ) {
			return self::stream( array(), $answer['error'] );
		}

		self::count_message( $caller );

		/**
		 * Filters the answer before the visitor reads it.
		 *
		 * The counterpart to the filters that shape what goes in. House style
		 * lives here: cutting an opening pleasantry, swapping a product name,
		 * appending a line the legal team wants on every reply. Anything that
		 * is a matter of taste belongs in a theme or a plugin rather than in
		 * this one's opinion of how a support agent should sound.
		 *
		 * @param string $text    The answer as the model wrote it.
		 * @param array  $matches The passages it was written from.
		 */
		// And read again on the way out, because the checks that matter most
		// are the ones about an answer that already exists.
		$leaving = Safety::verdict( Safety::check_output( $answer['text'], $matches ) );
		if ( null !== $leaving && 'flag' !== $leaving['action'] ) {
			do_action( 'recourse_answer_refused', $leaving['category'], $leaving['reason'] );

			return self::stream( $matches, '', $leaving['message'] );
		}

		$text = (string) apply_filters( 'recourse_answer', $answer['text'], $matches );

		return self::stream( $matches, '', $text );
	}

	/**
	 * Answers with an event stream instead of a JSON body.
	 *
	 * Through `rest_pre_serve_request` rather than by echoing and calling
	 * `exit`. Both put the same bytes on the wire, but `exit` skips the rest of
	 * the request: shutdown hooks do not fire, and an object cache that writes
	 * at shutdown loses whatever the turn stored, the rate limit counter
	 * included.
	 *
	 * @param array<int, array<string, mixed>> $matches Retrieved passages.
	 * @param string                           $error   An error to send instead of an answer.
	 * @param string                           $text    The answer.
	 * @return \WP_REST_Response
	 */
	private static function stream( $matches, $error = '', $text = '' ) {
		$frames = array();

		if ( '' !== $error ) {
			$frames[] = array(
				'type'    => 'error',
				'message' => $error,
			);
		} else {
			$frames[] = array(
				'type'    => 'sources',
				'sources' => Prompt::sources( $matches ),
			);
			$frames[] = array(
				'type' => 'delta',
				'text' => $text,
			);
		}

		$frames[] = array( 'type' => 'done' );

		add_filter(
			'rest_pre_serve_request',
			/**
			 * Writes the frames and tells the REST server they were served.
			 *
			 * @param bool $served Whether the request has already been served.
			 * @return bool
			 */
			function ( $served ) use ( $frames ) {
				if ( $served ) {
					return $served;
				}

				self::write( $frames );

				return true;
			}
		);

		return new \WP_REST_Response( null, 200 );
	}

	/**
	 * Puts the frames on the wire.
	 *
	 * @param array<int, array<string, mixed>> $frames Frames.
	 * @return void
	 */
	private static function write( $frames ) {
		// Buffering is what turns an event stream into one silent pause followed
		// by everything at once. Some of it is the host's and cannot be undone
		// from here, which is why the widget does not depend on frames arriving
		// separately.
		while ( ob_get_level() > 0 ) {
			ob_end_flush();
		}

		header( 'Content-Type: text/event-stream; charset=utf-8' );
		header( 'Cache-Control: no-cache, no-store, must-revalidate' );
		// nginx buffers a proxied response by default, which would hold the
		// whole stream back until the request ends.
		header( 'X-Accel-Buffering: no' );

		foreach ( $frames as $frame ) {
			self::frame( $frame );
		}
	}

	/**
	 * Writes one frame.
	 *
	 * @param array<string, mixed> $frame Frame.
	 * @return void
	 */
	private static function frame( $frame ) {
		echo 'data: ' . wp_json_encode( $frame ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		flush();
	}

	/**
	 * Reads and bounds the conversation.
	 *
	 * @param mixed $raw Whatever arrived.
	 * @return array<int, array<string, string>>
	 */
	private static function messages( $raw ) {
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$messages = array();

		foreach ( $raw as $message ) {
			if ( ! is_array( $message ) || ! isset( $message['role'], $message['content'] ) ) {
				continue;
			}

			$role = 'assistant' === $message['role'] ? 'assistant' : 'user';

			// Not `sanitize_text_field`: it collapses the newlines a customer
			// used to separate an address or a list of order numbers, and the
			// content is never rendered as HTML, the widget writes it with
			// textContent and the model reads it as text.
			$content = trim( wp_check_invalid_utf8( (string) $message['content'] ) );

			if ( '' === $content ) {
				continue;
			}

			$messages[] = array(
				'role'    => $role,
				'content' => mb_substr( $content, 0, self::MAX_MESSAGE ),
			);
		}

		return array_slice( $messages, -self::MAX_HISTORY );
	}

	/**
	 * Who is asking, for rate limiting.
	 *
	 * A hash rather than the address itself: this goes in the options table
	 * with an expiry, and storing visitors' IP addresses is a data-protection
	 * decision no shop owner asked to make.
	 *
	 * @return string
	 */
	private static function caller() {
		$address = '';

		if ( isset( $_SERVER['REMOTE_ADDR'] ) ) {
			$address = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
		}

		return substr( md5( $address . wp_salt() ), 0, 12 );
	}

	/**
	 * Whether this visitor has had their allowance.
	 *
	 * Transients, because they are the only shared store every WordPress has.
	 * On a site with an object cache this is fast and shared across processes;
	 * without one it is a row in the options table, which is fine at the volume
	 * a chat widget produces.
	 *
	 * @param string $caller Caller hash.
	 * @return bool
	 */
	private static function over_limit( $caller ) {
		/**
		 * Filters the number of messages allowed per window.
		 *
		 * @param int    $limit  Messages.
		 * @param string $caller Caller hash.
		 */
		$limit = (int) apply_filters( 'recourse_rate_limit', self::RATE_LIMIT, $caller );

		if ( $limit <= 0 ) {
			return false;
		}

		return (int) get_transient( 'recourse_rate_' . $caller ) >= $limit;
	}

	/**
	 * Counts one answered message.
	 *
	 * Counted after the model answered rather than before, so a visitor is not
	 * charged for a turn the site failed to serve.
	 *
	 * @param string $caller Caller hash.
	 * @return void
	 */
	private static function count_message( $caller ) {
		$key   = 'recourse_rate_' . $caller;
		$count = (int) get_transient( $key );

		// The window restarts from the first message rather than sliding, which
		// is the honest limitation of doing this with transients: a visitor
		// gets their allowance back all at once.
		set_transient( $key, $count + 1, self::RATE_WINDOW );
	}
}
