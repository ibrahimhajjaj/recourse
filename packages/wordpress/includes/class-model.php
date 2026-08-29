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
	 * Asks the model.
	 *
	 * @param string                            $instructions System prompt.
	 * @param array<int, array<string, string>> $messages     Conversation.
	 * @param array<string, string>             $config       Keys: base_url, api_key, model.
	 * @return array{ok: bool, text: string, error: string}
	 */
	public static function answer( $instructions, $messages, $config ) {
		$base = isset( $config['base_url'] ) ? untrailingslashit( trim( $config['base_url'] ) ) : '';
		$name = isset( $config['model'] ) ? trim( $config['model'] ) : '';

		if ( '' === $base || '' === $name ) {
			return self::failure( __( 'The assistant is not configured yet.', 'helpdeck' ) );
		}

		$payload = array(
			'model'       => $name,
			'messages'    => array_merge(
				array(
					array(
						'role'    => 'system',
						'content' => $instructions,
					),
				),
				$messages
			),
			// Support answers should be reproducible. A shop owner who tests a
			// question and gets a different answer on the second try has no way
			// to tell a fix from luck.
			'temperature' => 0,
			'stream'      => false,
		);

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

		$text = isset( $body['choices'][0]['message']['content'] ) ? $body['choices'][0]['message']['content'] : '';

		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			self::log( 'the model returned an empty answer' );

			return self::failure( __( 'The assistant had nothing to say. Try rephrasing.', 'helpdeck' ) );
		}

		return array(
			'ok'    => true,
			'text'  => self::without_reasoning( $text ),
			'error' => '',
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
		return self::answer(
			'Reply with the single word: ready.',
			array(
				array(
					'role'    => 'user',
					'content' => 'Are you there?',
				),
			),
			$config
		);
	}

	/**
	 * A failure the customer can be shown.
	 *
	 * @param string $message Message.
	 * @return array{ok: bool, text: string, error: string}
	 */
	private static function failure( $message ) {
		return array(
			'ok'    => false,
			'text'  => '',
			'error' => $message,
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
