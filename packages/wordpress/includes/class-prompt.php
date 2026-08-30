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
	 * What each tone means, in rules rather than adjectives.
	 *
	 * The alternative every product in this space ships is an empty box marked
	 * "instructions", and an empty box is the hardest thing to fill in. What
	 * comes back is adjectives: professional, friendly, helpful. None of those
	 * change a sentence the model writes, because a model already trying to be
	 * helpful cannot try harder.
	 *
	 * Kept short on purpose. These sit alongside a dozen answering rules, and a
	 * tone that argues with them at length wins arguments it should lose: a
	 * warm agent that invents a refund to be nice has done more damage than a
	 * curt one. Voice shapes the sentence, never the fact.
	 *
	 * @return array<string, array<int, string>>
	 */
	private static function tones() {
		return array(
			'plain'  => array(
				'Write the way you would to a colleague: direct, unfussy, no ceremony. One exclamation mark in a conversation is plenty.',
			),
			'warm'   => array(
				'Sound like a person who is glad they can help. Use their name if you know it.',
				'If something has gone wrong for them, say so before you say anything else. One line, meant, then the fix. Do not perform sympathy you have not earned by reading what they wrote.',
			),
			'brisk'  => array(
				'The shortest correct answer, and then stop. No preamble, no summary of what you just said, no offer to help further unless there is a real next step.',
				'One sentence is a complete reply when one sentence is the answer.',
			),
			'formal' => array(
				'Full sentences, no contractions, no slang, no emoji. Address them as you would in a letter.',
				'Formal is not distant. Say the useful thing plainly; do not pad it out to sound official.',
			),
		);
	}

	/**
	 * How much voice a tone may carry.
	 *
	 * A tone shapes a sentence, never a fact. Somebody pasting forty rules of
	 * personality is writing a system prompt, and it would start winning
	 * arguments against the grounding rules that keep the answers true.
	 */
	const MAX_TONE_RULES = 12;

	/**
	 * The rules for a tone: a built-in one, or one somebody wrote.
	 *
	 * The two are told apart by shape rather than by a second setting, because
	 * a second setting is a thing to explain and get wrong. A built-in is a
	 * bare word. A written tone is a list of "- " lines, so sharing one is
	 * sending a file and adopting one is pasting it into the box. Prose around
	 * the bullets is dropped, letting a tone read as a document.
	 *
	 * An unknown bare word is ignored rather than rejected. A site whose agent
	 * stops answering everybody because somebody typed "freindly" into a text
	 * field has failed worse than one that reads slightly wrong for an
	 * afternoon.
	 *
	 * @param  string $tone Chosen tone: a built-in name, or written rules.
	 * @return array<int, string>
	 */
	private static function tone_rules( $tone ) {
		if ( ! is_string( $tone ) || '' === trim( $tone ) ) {
			return array();
		}

		$tone  = trim( $tone );
		$tones = self::tones();

		if ( isset( $tones[ $tone ] ) ) {
			$lines = array();
			foreach ( $tones[ $tone ] as $rule ) {
				$lines[] = '- ' . $rule;
			}

			return $lines;
		}

		$lines = array();
		foreach ( preg_split( '/\R/', $tone ) as $line ) {
			$line = trim( $line );
			if ( preg_match( '/^[-*]\s+(\S.*)$/', $line, $found ) ) {
				$lines[] = '- ' . $found[1];
			}
		}

		return array_slice( $lines, 0, self::MAX_TONE_RULES );
	}

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
		// In the shopper's vocabulary rather than the site owner's. Nobody
		// writing in has a mental model of an index, and a sentence that
		// mentions one sounds like a machine reporting a failed lookup.
		$fallback = isset( $persona['fallback'] ) && '' !== $persona['fallback']
			? $persona['fallback']
			: "I'm not sure about that one. Could you put it another way, or shall I pass you to someone on the team?";

		// A procedure rather than a list.
		//
		// The list came first and grew a rule every time a live conversation went
		// wrong: a greeting refused, "are you human" refused, three questions
		// answered with one refusal, a password request answered as a failed
		// lookup. All of them were patches on one wound: a single line saying
		// "when you cannot answer, say this and stop", sitting at the same level
		// as everything else and winning, because a sentence that broad wins
		// every argument it is allowed to have.
		//
		// The fallback is no longer a rule. It lives inside the one branch it
		// belongs to and cannot reach the others.
		$business_name = isset( $persona['business'] ) && '' !== $persona['business']
			? $persona['business']
			: 'this business';

		$lines = array(
			'You are ' . $name . ', a customer support agent' . $business . '. You are an AI assistant, and you say so plainly whenever anyone asks.',
			'',
			'Work out what they want, then follow the matching step. A message can hold several; handle each part on its own, and never let one part decide the answer to another.',
			'',
			'1. Saying hello, thank you or goodbye. Answer in one short line and wait for the real question. Nothing below applies.',
			'',
			'2. Asking about you: what you are, whether you are a person, what you can help with. Answer from this paragraph and stop. You are an AI assistant, never a human, and you help with questions about ' . $business_name . ' answered from its help pages' . ( $has_actions ? ', and with the things your actions can do' : '' ) . '. The help pages are not consulted for this and are not needed for it.',
			'',
			'3. Asking for something you will never do: a password, a card number, anyone else\'s account or details. Say plainly that you cannot, in your own words, the way a person would, and give them the step that actually solves it. Never write "contact us", "contact support", "reach out to us", "get in touch with us" or "contact customer service", because they are contacting you right now; offer to pass them to someone on the team, or name a real place such as the password reset page. If they say they already tried what you suggested, do not suggest it again: offer the person.',
			'',
			$has_actions
				? '4. Asking something you could look up. Answer from the numbered sources below and from what your actions return, and nothing else. The sources are help pages rather than live data, so a question needing an order, a stock level or a ticket wants an action; not finding it in the sources is not an answer. If neither the sources nor an action can answer that part, reply to that part with exactly this and nothing more: "' . $fallback . '"'
				: '4. Asking something you could look up. Answer from the numbered sources below and nothing else. If the sources cannot answer that part, reply to that part with exactly this and nothing more: "' . $fallback . '"',
			'',
			'Always:',
			'- Never invent a price, a policy, a date, a URL, an order detail or an availability. If one is not in the sources or in what an action returned, you do not have it, and saying so is the answer.',
			'- Cite the sources you used inline as [1], [2]. Cite only what you actually relied on.',
			'- Be brief. Two or three sentences unless the question genuinely needs steps.',
			'- Reply in the language the customer wrote in.',
			// Not a matter of taste, which is why it sits here rather than inside
			// a tone. Every tone is worse with it, and small models reach for it
			// hardest.
			'- Do not open with "Great question", "I\'d be happy to help", "Certainly", "Absolutely", or an apology for a problem that has not happened yet. Start with the answer.',
		);

		$lines = array_merge( $lines, self::tone_rules( isset( $persona['tone'] ) ? $persona['tone'] : '' ) );

		if ( isset( $persona['instructions'] ) && '' !== $persona['instructions'] ) {
			$lines[] = '';
			$lines[] = $persona['instructions'];
		}

		if ( empty( $matches ) ) {
			// A citation with nothing behind it is worse than none: it invites
			// the reader to check something that does not exist, and models
			// reach for [1] out of habit once the rest of the prompt has told
			// them to cite.
			//
			// The second line is here rather than with the answering rules
			// because this is the last thing the model reads, and the last
			// thing it reads is "you have nothing". Live, that beat the
			// exceptions written above it. A rule only wins where it is read.
			$lines[] = '';
			$lines[] = 'There are no sources for this question. Do not write [1] or any other citation.';
			$lines[] = 'That is about the documentation and nothing else. A greeting, a question about you or what you can do, and anything you will never do are all still answered as set out above, not with the fallback.';
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
