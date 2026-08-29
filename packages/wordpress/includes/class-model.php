<?php
/**
 * Calling the model, from the server.
 *
 * The credential lives in `wp-config.php` or in the options table and never
 * reaches a browser. That is the difference between this and pasting a
 * vendor's script tag into a theme: with a script tag the key is either in the
 * page or the vendor holds your content, and there is no third option.
 *
 * Any OpenAI-compatible endpoint works, which in practice means all of them,
 * OpenAI, Groq, Together, OpenRouter, a Cloudflare Workers AI binding, or
 * Ollama on a box in the office.
 *
 * **This does not stream.** WordPress's HTTP API cannot: `wp_remote_post` reads
 * a whole response before returning, and the alternative is raw cURL with a
 * write callback, which is the sort of thing that gets a plugin rejected and
 * breaks on hosts that disable it. So the answer is fetched whole and then sent
 * to the browser as one event, which costs the typewriter effect and nothing
 * else. The widget renders either the same way.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * One model call.
 */
class Model {

	/**
	 * Seconds to wait for an answer.
	 *
	 * Generous, because a small self-hosted model on a cold start is slow and
	 * the alternative is a customer being told the assistant is unavailable
	 * when it was merely thinking.
	 */
	const TIMEOUT = 60;

	/**
	 * Asks the model, letting it call actions on the way.
	 *
	 * A loop rather than one request, because a tool call is a turn: the model
	 * asks for a lookup, gets the result, and only then writes an answer. It is
	 * bounded, because a model that keeps asking for the same lookup is a model
	 * spending somebody's money in a circle.
	 *
	 * Small local models are unreliable at this. When one returns no tool call
	 * the loop simply ends with whatever text it produced, which is the same
	 * behaviour as having no actions at all rather than an error.
	 *
	 * @param string                            $instructions System prompt.
	 * @param array<int, array<string, string>> $messages     Conversation.
	 * @param array<string, string>             $config       Keys: base_url, api_key, model.
	 * @param array<string, mixed>              $context      Passed to action callbacks.
	 * @return array{ok: bool, text: string, error: string, used: array<int, string>}
	 */
	public static function answer( $instructions, $messages, $config, $context = array() ) {
		$actions = Actions::all();
		$tools   = Actions::to_tools( $actions );

		// Nothing configured here, but the site has WordPress's own AI client
		// and a connector behind it. Then there is nothing to configure: the
		// key is the site's, the provider is the site's, and this plugin never
		// sees either.
		if ( '' === trim( isset( $config['base_url'] ) ? $config['base_url'] : '' ) && self::core_client_available() ) {
			return self::via_core_client( $instructions, $messages );
		}

		$turns = array_merge(
			array(
				array(
					'role'    => 'system',
					'content' => $instructions . Actions::instructions( $actions ),
				),
			),
			$messages
		);

		$used = array();

		for ( $step = 0; $step < Actions::MAX_STEPS; $step++ ) {
			$reply = self::request( $turns, $tools, $config );

			if ( ! $reply['ok'] ) {
				return array_merge( $reply, array( 'used' => $used ) );
			}

			$calls = $reply['tool_calls'];

			if ( empty( $calls ) ) {
				return array(
					'ok'    => true,
					'text'  => self::without_reasoning( $reply['text'] ),
					'error' => '',
					'used'  => $used,
				);
			}

			// The assistant's own turn has to go back verbatim, tool calls and
			// all, or the provider rejects the results that follow it.
			$turns[] = $reply['message'];

			foreach ( $calls as $call ) {
				$name      = isset( $call['function']['name'] ) ? (string) $call['function']['name'] : '';
				$arguments = isset( $call['function']['arguments'] ) ? $call['function']['arguments'] : '{}';
				$input     = json_decode( is_string( $arguments ) ? $arguments : '{}', true );

				$outcome = Actions::run( $name, is_array( $input ) ? $input : array(), $context );
				$used[]  = $name;

				$turns[] = array(
					'role'         => 'tool',
					'tool_call_id' => isset( $call['id'] ) ? (string) $call['id'] : $name,
					'content'      => (string) wp_json_encode( $outcome ),
				);
			}
		}

		// Out of steps with no answer written. Saying so is better than showing
		// the customer the last half-finished thought.
		self::log( 'the model used every step without answering' );

		return array(
			'ok'    => false,
			'text'  => '',
			'error' => __( 'That took too long to work out. Try asking a simpler question.', 'helpdeck' ),
			'used'  => $used,
		);
	}

	/**
	 * Whether this WordPress can call a model on its own.
	 *
	 * `wp_supports_ai()` answers whether the client exists, not whether a
	 * provider is connected, so a site with no connector passes this and fails
	 * at generation. The failure is handled where it happens rather than
	 * predicted here.
	 *
	 * @return bool
	 */
	private static function core_client_available() {
		return function_exists( 'wp_ai_client_prompt' ) && function_exists( 'wp_supports_ai' ) && wp_supports_ai();
	}

	/**
	 * Answers through the AI client built into WordPress 7.0 and later.
	 *
	 * Actions travel as abilities, which is how core does tool calling: it
	 * converts each one to a function declaration and runs the loop itself. So
	 * only abilities are reachable on this path, not actions registered through
	 * this plugin's own filter.
	 *
	 * @param string                            $instructions System prompt.
	 * @param array<int, array<string, string>> $messages     Conversation.
	 * @return array{ok: bool, text: string, error: string, used: array<int, string>}
	 */
	private static function via_core_client( $instructions, $messages ) {
		$question = '';

		foreach ( array_reverse( $messages ) as $message ) {
			if ( isset( $message['role'] ) && 'user' === $message['role'] ) {
				$question = (string) $message['content'];
				break;
			}
		}

		$prompt = wp_ai_client_prompt( $question )
			->using_system_instruction( $instructions )
			->using_temperature( 0 );

		$text = $prompt->generate_text();

		if ( is_wp_error( $text ) ) {
			self::log( 'the core AI client refused: ' . $text->get_error_message() );

			return array(
				'ok'    => false,
				'text'  => '',
				'error' => __( 'The assistant is not configured yet.', 'helpdeck' ),
				'used'  => array(),
			);
		}

		return array(
			'ok'    => true,
			'text'  => self::without_reasoning( (string) $text ),
			'error' => '',
			'used'  => array(),
		);
	}

	/**
	 * One request to the provider.
	 *
	 * @param array<int, array<string, mixed>> $turns  Conversation so far.
	 * @param array<int, array<string, mixed>> $tools  Actions on offer.
	 * @param array<string, string>            $config Keys: base_url, api_key, model.
	 * @return array{ok: bool, text: string, error: string, tool_calls: array<int, mixed>, message: array<string, mixed>}
	 */
	private static function request( $turns, $tools, $config ) {
		$base = isset( $config['base_url'] ) ? untrailingslashit( trim( $config['base_url'] ) ) : '';
		$name = isset( $config['model'] ) ? trim( $config['model'] ) : '';

		if ( '' === $base || '' === $name ) {
			return self::failure( __( 'The assistant is not configured yet.', 'helpdeck' ) );
		}

		$payload = array(
			'model'       => $name,
			'messages'    => $turns,
			// Support answers should be reproducible. A shop owner who tests a
			// question and gets a different answer on the second try has no way
			// to tell a fix from luck.
			'temperature' => 0,
			'stream'      => false,
		);

		if ( ! empty( $tools ) ) {
			$payload['tools']       = $tools;
			$payload['tool_choice'] = 'auto';
		}

		$headers = array( 'Content-Type' => 'application/json' );

		if ( isset( $config['api_key'] ) && '' !== $config['api_key'] ) {
			$headers['Authorization'] = 'Bearer ' . $config['api_key'];
		}

		$response = wp_remote_post(
			$base . '/chat/completions',
			array(
				'timeout' => self::TIMEOUT,
				'headers' => $headers,
				'body'    => wp_json_encode( $payload ),
			)
		);

		if ( is_wp_error( $response ) ) {
			// The message goes to the log and not to the customer: it can carry
			// the endpoint and, on some hosts, the proxy's own credentials.
			self::log( 'request failed: ' . $response->get_error_message() );

			return self::failure( __( 'The assistant could not be reached just now.', 'helpdeck' ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status ) {
			$detail = isset( $body['error']['message'] ) ? $body['error']['message'] : '';
			self::log( sprintf( 'the model answered %d: %s', $status, $detail ) );

			// Translated for the customer, specific in the log. A provider's
			// raw JSON in a chat bubble is how a key ends up in a screenshot.
			if ( 401 === $status || 403 === $status ) {
				return self::failure( __( 'The assistant is not configured correctly.', 'helpdeck' ) );
			}
			if ( 429 === $status ) {
				return self::failure( __( 'The assistant is busy. Try again in a moment.', 'helpdeck' ) );
			}

			return self::failure( __( 'The assistant could not answer just now.', 'helpdeck' ) );
		}

		$message = isset( $body['choices'][0]['message'] ) && is_array( $body['choices'][0]['message'] )
			? $body['choices'][0]['message']
			: array();

		$text  = isset( $message['content'] ) && is_string( $message['content'] ) ? $message['content'] : '';
		$calls = isset( $message['tool_calls'] ) && is_array( $message['tool_calls'] ) ? $message['tool_calls'] : array();

		// A turn that asks for a lookup often carries no text at all, so empty
		// content is only a failure when there is nothing else in the reply.
		if ( '' === trim( $text ) && empty( $calls ) ) {
			self::log( 'the model returned an empty answer' );

			return self::failure( __( 'The assistant had nothing to say. Try rephrasing.', 'helpdeck' ) );
		}

		return array(
			'ok'         => true,
			'text'       => $text,
			'error'      => '',
			'tool_calls' => $calls,
			'message'    => $message,
		);
	}

	/**
	 * Removes a reasoning block from the answer.
	 *
	 * Models that think out loud wrap it in `<think>` tags, and some endpoints
	 * pass that through in the content rather than in a field of its own. The
	 * customer should not read the model working out whether to trust them.
	 *
	 * @param string $text Answer.
	 * @return string
	 */
	private static function without_reasoning( $text ) {
		$stripped = preg_replace( '#<think>.*?</think>#is', '', $text );

		// An unterminated block means the answer was cut off mid-thought, and
		// what is left is not an answer at all.
		if ( false !== stripos( $stripped, '<think>' ) ) {
			$stripped = preg_replace( '#<think>.*$#is', '', $stripped );
		}

		return trim( $stripped );
	}

	/**
	 * Checks a configuration by using it.
	 *
	 * @param array<string, string> $config Keys: base_url, api_key, model.
	 * @return array{ok: bool, text: string, error: string}
	 */
	public static function check( $config ) {
		// Straight to the provider, with no actions offered. A connection test
		// that can call a lookup is a connection test that can charge somebody
		// for a lookup.
		return self::request(
			array(
				array(
					'role'    => 'system',
					'content' => 'Reply with the single word: ready.',
				),
				array(
					'role'    => 'user',
					'content' => 'Are you there?',
				),
			),
			array(),
			$config
		);
	}

	/**
	 * A failure the customer can be shown.
	 *
	 * @param string $message Message.
	 * @return array{ok: bool, text: string, error: string, tool_calls: array<int, mixed>, message: array<string, mixed>}
	 */
	private static function failure( $message ) {
		return array(
			'ok'         => false,
			'text'       => '',
			'error'      => $message,
			'tool_calls' => array(),
			'message'    => array(),
		);
	}

	/**
	 * Logs, when the site has debug logging on.
	 *
	 * @param string $message Message.
	 * @return void
	 */
	private static function log( $message ) {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[helpdeck] ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}
}
