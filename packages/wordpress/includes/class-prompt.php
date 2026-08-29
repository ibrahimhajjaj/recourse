<?php
/**
 * The instructions the model is given.
 *
 * The same three jobs as the core's prompt, in the same order, because the
 * ordering matters more than the wording: fence the model to the retrieved
 * passages, force a citation, and give it an honest way out.
 *
 * The third job is the one that gets left out, and leaving it out is where bad
 * support bots come from. A model with no sanctioned way to say "I don't know"
 * will invent something instead.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * Builds prompts and citation lists.
 */
class Prompt {

	/**
	 * Builds the system prompt.
	 *
	 * @param array<int, array<string, mixed>> $matches     Retrieved passages.
	 * @param array<string, string>            $persona     Keys: name, business, fallback, instructions.
	 * @param bool                             $has_actions Whether the agent has actions to reach for.
	 * @return string
	 */
	public static function instructions( $matches, $persona = array(), $has_actions = false ) {
		$name     = isset( $persona['name'] ) && '' !== $persona['name'] ? $persona['name'] : 'the support assistant';
		$business = isset( $persona['business'] ) && '' !== $persona['business'] ? ' for ' . $persona['business'] : '';
		$fallback = isset( $persona['fallback'] ) && '' !== $persona['fallback']
			? $persona['fallback']
			: "I don't have that in my documentation. Could you rephrase, or would you like me to pass this to a human?";

		$lines = array(
			'You are ' . $name . ', a customer support agent' . $business . '.',
			'',
			'Answering:',
			$has_actions
				? '- Answer from the numbered sources below and from what your actions return. Nothing else.'
				: '- Answer from the numbered sources below. Nothing else.',
		);

		// Ordered deliberately. A model told "say the fallback when the sources
		// do not answer" reaches for it the moment retrieval comes back empty,
		// which is exactly the moment an action was going to earn its keep. An
		// order lookup is never in the help pages.
		if ( $has_actions ) {
			$lines[] = '- The sources are help pages, not live data. If the question needs something only an action can get, use the action. Not finding it in the sources is not an answer.';
			$lines[] = '- Only when the sources cannot answer and no action can either, say exactly this and stop: "' . $fallback . '"';
		} else {
			$lines[] = '- If the sources do not answer the question, say exactly this and stop: "' . $fallback . '"';
		}

		$lines = array_merge(
			$lines,
			array(
				'- Never invent prices, policies, dates, URLs, order details or availability. A wrong answer costs more than no answer.',
				'- Cite the sources you used inline as [1], [2]. Cite only what you actually relied on.',
				'- Be brief. Two or three sentences unless the question genuinely needs steps.',
				'- Reply in the language the customer wrote in.',
			)
		);

		if ( isset( $persona['instructions'] ) && '' !== $persona['instructions'] ) {
			$lines[] = '';
			$lines[] = $persona['instructions'];
		}

		if ( empty( $matches ) ) {
			// A citation with nothing behind it is worse than none: it invites
			// the reader to check something that does not exist, and models
			// reach for [1] out of habit once the rest of the prompt has told
			// them to cite.
			$lines[] = '';
			$lines[] = 'There are no sources for this question. Do not write [1] or any other citation.';
			$lines[] = '';
			$lines[] = 'Sources: nothing in the documentation matched this question.';

			return implode( "\n", $lines );
		}

		$context  = array();
		$position = 1;

		foreach ( $matches as $match ) {
			$chunk   = $match['chunk'];
			$heading = array();

			foreach ( array( 'title', 'section' ) as $field ) {
				if ( isset( $chunk[ $field ] ) && '' !== $chunk[ $field ] ) {
					$heading[] = $chunk[ $field ];
				}
			}

			$context[] = '[' . $position . '] ' . implode( ' > ', $heading ) . "\n" . $chunk['text'];
			++$position;
		}

		$lines[] = '';
		$lines[] = "Sources:\n\n" . implode( "\n\n---\n\n", $context );

		return implode( "\n", $lines );
	}

	/**
	 * The citation list, numbered exactly as the prompt numbers its sources.
	 *
	 * These two numberings have to be the same list. Deduplicating by page here
	 * while the prompt numbers every passage means a model that cites [4]
	 * points at an entry the client does not have, and the citation silently
	 * disappears.
	 *
	 * @param array<int, array<string, mixed>> $matches Retrieved passages.
	 * @return array<int, array<string, string>>
	 */
	public static function sources( $matches ) {
		$sources = array();

		foreach ( $matches as $match ) {
			$chunk = $match['chunk'];
			$title = isset( $chunk['title'] ) ? $chunk['title'] : '';

			$source = array( 'title' => $title );

			if ( isset( $chunk['url'] ) && '' !== $chunk['url'] ) {
				$source['url'] = $chunk['url'];
			}

			if ( isset( $chunk['section'] ) && '' !== $chunk['section'] ) {
				$parts   = explode( '>', $chunk['section'] );
				$deepest = trim( end( $parts ) );

				if ( '' !== $deepest && $deepest !== $title ) {
					$source['section'] = $deepest;
				}
			}

			$sources[] = $source;
		}

		return $sources;
	}

	/**
	 * What to retrieve on: the latest question, on its own.
	 *
	 * @param array<int, array<string, string>> $messages Conversation so far.
	 * @return string
	 */
	public static function retrieval_query( $messages ) {
		$questions = self::questions( $messages );

		return empty( $questions ) ? '' : (string) end( $questions );
	}

	/**
	 * The question with the previous one prepended, for a follow-up like "and
	 * the refund?" that carries no subject of its own.
	 *
	 * A fallback rather than the default, and the reason matters: folding the
	 * previous turn in every time means a customer who changes the subject,
	 * asking "do you sell tea?" straight after a delivery question, retrieves
	 * the old topic and gets answered about the wrong thing. Trying the bare
	 * question first and only reaching for context when it finds nothing gets
	 * both cases right.
	 *
	 * @param array<int, array<string, string>> $messages Conversation so far.
	 * @return string|null
	 */
	public static function contextual_query( $messages ) {
		$questions = self::questions( $messages );

		if ( count( $questions ) < 2 ) {
			return null;
		}

		return $questions[ count( $questions ) - 2 ] . "\n" . $questions[ count( $questions ) - 1 ];
	}

	/**
	 * The customer's turns, in order.
	 *
	 * @param array<int, array<string, string>> $messages Conversation so far.
	 * @return array<int, string>
	 */
	private static function questions( $messages ) {
		$questions = array();

		foreach ( $messages as $message ) {
			if ( isset( $message['role'] ) && 'user' === $message['role'] ) {
				$questions[] = (string) $message['content'];
			}
		}

		return $questions;
	}
}
