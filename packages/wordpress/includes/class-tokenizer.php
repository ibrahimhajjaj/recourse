<?php
/**
 * The same tokeniser as the TypeScript core, in PHP.
 *
 * The plugin's whole argument is that a shop on shared hosting needs no Node,
 * which means the index has to be built and queried here. That creates the
 * obvious risk of two implementations of one policy drifting apart, so the
 * tests assert agreement against fixtures generated from the TypeScript rather
 * than trusting that this reads like a faithful port.
 *
 * Anything changed here has to be changed in `knowledge/tokenize.ts` too, and
 * the parity test is what will tell you that you forgot.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Splits text into the terms the index is built from.
 */
class Tokenizer {

	/**
	 * Cached stopword lookup, built once per request.
	 *
	 * @var array<string, bool>|null
	 */
	private static $stopwords = null;

	/**
	 * The usual English filler, plus the light verbs that carry no topic.
	 *
	 * Without the second group, "how long does delivery take" matches every
	 * page containing the word "takes", which is most of them.
	 *
	 * @return array<string, bool>
	 */
	private static function stopwords() {
		if ( null !== self::$stopwords ) {
			return self::$stopwords;
		}

		$words =
			'a about after all also am an and any are as at be because been before being but by can could did do ' .
			'does doing done down during each few for from further had has have having he her here hers him his how ' .
			'i if in into is it its just me more most my no nor not of off on once only or other our out over own ' .
			'same she should so some such than that the their them then there these they this those through to too ' .
			'under until up us very was we were what when where which while who whom why will with would you your yours ' .
			'get gets got getting take takes taken taking make makes made making need needs want wants know known ' .
			'like see go going come came say says said tell tells ask asks please thanks thank hi hello ' .
			'one two many much lot really actually still even ever never always sure ok okay yes';

		self::$stopwords = array_fill_keys( explode( ' ', $words ), true );

		return self::$stopwords;
	}

	/**
	 * Suffixes that change a word's part of speech without changing what it is
	 * about. "Freshness" is a heading, "stay fresh" is how somebody asks about
	 * it, and an index that cannot connect the two loses the answer.
	 *
	 * Ordered longest first and applied once. Deliberately short: a longer list
	 * buys recall at the cost of precision on every other query.
	 *
	 * @var array<int, array{0: string, 1: string}>
	 */
	private static $derivations = array(
		array( 'fulness', 'ful' ),
		array( 'ousness', 'ous' ),
		array( 'iveness', 'ive' ),
		array( 'ability', 'able' ),
		array( 'ibility', 'ible' ),
		array( 'ational', 'ate' ),
		array( 'ization', 'ize' ),
		array( 'fulness', 'ful' ),
		array( 'ication', 'ify' ),
		array( 'iveness', 'ive' ),
		array( 'ousness', 'ous' ),
		array( 'ational', 'ate' ),
		array( 'tional', 'tion' ),
		array( 'ements', 'e' ),
		array( 'ement', 'e' ),
		array( 'ments', '' ),
		array( 'ness', '' ),
		array( 'ment', '' ),
		array( 'ities', 'ity' ),
		array( 'ance', '' ),
		array( 'ence', '' ),
		array( 'able', '' ),
		array( 'ible', '' ),
		array( 'ical', 'ic' ),
		array( 'less', '' ),
		array( 'ity', '' ),
		array( 'ful', '' ),
	);

	/**
	 * Splits text into stemmed terms.
	 *
	 * @param string $text Anything.
	 * @return array<int, string> Terms, in the order they appeared.
	 */
	public static function tokenize( $text ) {
		$out       = array();
		$stopwords = self::stopwords();

		// Combining marks are part of a word. Leaving them out cut words apart
		// at their own vowels: Arabic written with the marks a careful writer
		// types came out as fragments matching neither each other nor the
		// plain spelling, and Thai came apart the same way.
		$parts = preg_split( '/[^\p{L}\p{N}\p{M}]+/u', self::lower( self::normalise( $text ) ) );

		if ( false === $parts ) {
			return $out;
		}

		foreach ( $parts as $raw ) {
			if ( '' === $raw ) {
				continue;
			}

			// The common path, and nearly always the answer.
			if ( ! preg_match( self::UNSPACED, $raw ) ) {
				$word   = self::without_article( $raw );
				$length = self::length( $word );

				if ( $length < 2 || $length > 40 ) {
					continue;
				}
				if ( isset( $stopwords[ $word ] ) ) {
					continue;
				}

				$out[] = self::stem( $word );
				continue;
			}

			// Mixed runs are ordinary rather than exotic: a Japanese sentence
			// naming an English product, a Chinese page with a model number.
			$runs = array();
			if ( false === preg_match_all( self::RUNS, $raw, $runs ) ) {
				continue;
			}

			foreach ( $runs[0] as $run ) {
				if ( preg_match( self::UNSPACED, $run ) ) {
					foreach ( self::pairs( $run ) as $pair ) {
						$out[] = $pair;
					}
					continue;
				}

				$word   = self::without_article( $run );
				$length = self::length( $word );

				if ( $length < 2 || $length > 40 ) {
					continue;
				}
				if ( isset( $stopwords[ $word ] ) ) {
					continue;
				}

				$out[] = self::stem( $word );
			}
		}

		return $out;
	}

	/**
	 * Scripts that put no spaces between words.
	 *
	 * Splitting on spaces is a definition of "word" that half the world does
	 * not use. A Japanese sentence has none, so the rule above returned the
	 * whole sentence as one term, and a term that long matches only an
	 * identical sentence: a shop whose pages are in Japanese or Chinese
	 * retrieved nothing at all, silently.
	 *
	 * Hangul is absent on purpose. Korean is written with spaces, so it wants
	 * the ordinary path.
	 */
	const UNSPACED = '/[\p{Han}\p{Hiragana}\p{Katakana}\p{Thai}\p{Khmer}\p{Lao}\p{Myanmar}]/u';

	/** Runs of unspaced script, and runs of everything else, in order. */
	const RUNS = '/[\p{Han}\p{Hiragana}\p{Katakana}\p{Thai}\p{Khmer}\p{Lao}\p{Myanmar}]+|[^\p{Han}\p{Hiragana}\p{Katakana}\p{Thai}\p{Khmer}\p{Lao}\p{Myanmar}]+/u';

	/**
	 * Marks that are optional to write and never change which word it is.
	 *
	 * Arabic vowel marks and Hebrew points are pronunciation aids. Most
	 * writing omits them, some includes them, and the same word appears both
	 * ways in one corpus, so a reader who types the careful spelling must
	 * still find the plain one. Tatweel is pure typography: a stretched letter
	 * for justification.
	 *
	 * Thai vowel signs are deliberately not here. Those are not optional;
	 * removing one leaves a different word.
	 */
	const OPTIONAL_MARKS = '/[\x{0610}-\x{061A}\x{064B}-\x{065F}\x{0670}\x{06D6}-\x{06ED}\x{0640}\x{0591}-\x{05BD}\x{05BF}\x{05C1}\x{05C2}\x{05C4}\x{05C5}\x{05C7}]/u';

	/**
	 * Overlapping character pairs, which is how you index a script with no
	 * word boundaries and no dictionary to find them with.
	 *
	 * A pair is short enough to survive whatever the real boundary turns out
	 * to be, and specific enough to rank. Single characters are kept as
	 * themselves, because plenty of them are whole words.
	 *
	 * The alternative is a morphological analyser, which means a dictionary
	 * per language, megabytes of it, in a plugin whose entire argument is that
	 * it runs on shared hosting.
	 *
	 * @param string $run One run of unspaced script.
	 * @return array<int, string>
	 */
	private static function pairs( $run ) {
		$characters = preg_split( '//u', $run, -1, PREG_SPLIT_NO_EMPTY );

		if ( false === $characters || count( $characters ) < 2 ) {
			return false === $characters ? array() : $characters;
		}

		$out   = array();
		$total = count( $characters );

		for ( $at = 0; $at + 1 < $total; $at++ ) {
			$out[] = $characters[ $at ] . $characters[ $at + 1 ];
		}

		return $out;
	}

	/**
	 * One spelling per word, before anything tries to match two of them.
	 *
	 * Composing first matters because the same "cafe" with an accent arrives
	 * as four characters from one editor and five from another, and a rule
	 * that keeps combining marks would keep the two apart rather than
	 * throwing the accent away. Normalizer comes from intl, which is not on
	 * every shared host; without it the plugin is still self-consistent,
	 * because it both builds and queries its own index.
	 *
	 * The Arabic letter forms below are the ones writers use
	 * interchangeably. The hamza on an alef is dropped constantly in ordinary
	 * typing, final ya and alef maqsura are the same key to most people, and
	 * ta marbuta against ha is the single most common Arabic misspelling
	 * there is. Collapsing them is what every Arabic search does.
	 *
	 * @param string $text Anything.
	 * @return string
	 */
	private static function normalise( $text ) {
		if ( class_exists( '\Normalizer' ) ) {
			$composed = \Normalizer::normalize( $text, \Normalizer::FORM_C );

			if ( is_string( $composed ) ) {
				$text = $composed;
			}
		}

		$text = preg_replace( self::OPTIONAL_MARKS, '', $text );

		if ( null === $text ) {
			return '';
		}

		$forms = array(
			'/[\x{0622}\x{0623}\x{0625}\x{0671}]/u' => "\xD8\xA7",
			'/\x{0649}/u'                           => "\xD9\x8A",
			'/\x{0629}/u'                           => "\xD9\x87",
			'/\x{06CC}/u'                           => "\xD9\x8A",
			'/\x{06A9}/u'                           => "\xD9\x83",
		);

		foreach ( $forms as $pattern => $replacement ) {
			$next = preg_replace( $pattern, $replacement, $text );

			if ( null !== $next ) {
				$text = $next;
			}
		}

		return $text;
	}

	/**
	 * Arabic attaches the definite article to the front of the word, so a
	 * customer writing "the refund" and a page saying "refund" are using the
	 * same word and never match.
	 *
	 * Only alef-lam and the one-letter particles that fuse with it. Bare waw
	 * (and) is left alone deliberately: it is also the first letter of ordinary
	 * words, and stripping it changes what they mean.
	 *
	 * The length floor is what keeps the name of God whole: two letters left
	 * over is usually the wrong reading of a short word rather than a stem.
	 *
	 * @param string $word One word, already normalised and lowercased.
	 * @return string The word without its article, or unchanged.
	 */
	private static function without_article( $word ) {
		$articles = array( "\xD9\x88\xD8\xA7\xD9\x84", "\xD8\xA8\xD8\xA7\xD9\x84", "\xD9\x83\xD8\xA7\xD9\x84", "\xD9\x81\xD8\xA7\xD9\x84", "\xD9\x84\xD9\x84", "\xD8\xA7\xD9\x84" );
		$length   = self::length( $word );

		foreach ( $articles as $article ) {
			$size = self::length( $article );

			if ( 0 === strpos( $word, $article ) && $length - $size >= 3 ) {
				return function_exists( 'mb_substr' ) ? mb_substr( $word, $size, null, 'UTF-8' ) : substr( $word, strlen( $article ) );
			}
		}

		return $word;
	}

	/**
	 * Light suffix normalisation, so "pause"/"pausing" and
	 * "ship"/"shipping"/"shipped" collapse onto one term.
	 *
	 * The order is deliberate. Stripping "-ing" from "pausing" leaves "paus",
	 * so "pause" has to lose its silent "e" as well or the two never meet.
	 *
	 * @param string $word One lowercased word.
	 * @return string
	 */
	public static function stem( $word ) {
		$out = $word;

		// Plurals first: they compose with nothing else.
		if ( self::length( $out ) > 4 && self::ends_with( $out, 'ies' ) ) {
			$out = self::slice( $out, 0, -3 ) . 'y';
		} elseif ( self::length( $out ) > 4 && self::ends_with( $out, 'sses' ) ) {
			$out = self::slice( $out, 0, -2 );
		} elseif (
			self::length( $out ) > 3
			&& self::ends_with( $out, 's' )
			&& ! self::ends_with( $out, 'ss' )
			&& ! self::ends_with( $out, 'us' )
		) {
			$out = self::slice( $out, 0, -1 );
		}

		foreach ( self::$derivations as $rule ) {
			$suffix      = $rule[0];
			$replacement = $rule[1];

			// Guarded on what is left behind: over-stemming costs precision on
			// every query, so nothing here fires on a short word.
			if ( self::length( $out ) > self::length( $suffix ) + 3 && self::ends_with( $out, $suffix ) ) {
				$out = self::slice( $out, 0, -self::length( $suffix ) ) . $replacement;
				break;
			}
		}

		// Verb endings, only when something pronounceable is left behind.
		if ( self::length( $out ) > 5 && self::ends_with( $out, 'ing' ) && self::has_vowel( self::slice( $out, 0, -3 ) ) ) {
			$out = self::slice( $out, 0, -3 );
		} elseif ( self::length( $out ) > 4 && self::ends_with( $out, 'ed' ) && self::has_vowel( self::slice( $out, 0, -2 ) ) ) {
			$out = self::slice( $out, 0, -2 );
		}

		// Collapse a doubled final consonant, applied to every word rather than
		// only to stripped ones, so "call" and "calling" land on the same term.
		$last = self::slice( $out, -1 );
		if ( self::length( $out ) > 3 && self::slice( $out, -2 ) === $last . $last && false === strpos( 'sz', $last ) ) {
			$out = self::slice( $out, 0, -1 );
		}

		// Silent trailing "e". Guarded on length so "use" does not collapse
		// onto "us".
		if ( self::length( $out ) > 4 && self::ends_with( $out, 'e' ) ) {
			$out = self::slice( $out, 0, -1 );
		}

		return $out;
	}

	/**
	 * Whether a word has anything pronounceable in it.
	 *
	 * @param string $word Word.
	 * @return bool
	 */
	private static function has_vowel( $word ) {
		return 1 === preg_match( '/[aeiouy]/', $word );
	}

	/**
	 * Lowercase, by code point.
	 *
	 * `strtolower` is byte-wise and would leave every accented and non-Latin
	 * word untouched, which quietly halves recall on a site that is not in
	 * English.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	private static function lower( $text ) {
		if ( function_exists( 'mb_strtolower' ) ) {
			return mb_strtolower( $text, 'UTF-8' );
		}

		// mbstring is all but universal, and a site without it should still get
		// English right rather than nothing at all.
		return strtolower( $text );
	}

	/**
	 * Length in code points, matching what JavaScript counts for everything
	 * below the astral planes, which is everything the split above keeps.
	 *
	 * @param string $text Text.
	 * @return int
	 */
	private static function length( $text ) {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $text, 'UTF-8' ) : strlen( $text );
	}

	/**
	 * Substring by code point.
	 *
	 * @param string   $text   Text.
	 * @param int      $start  Start offset, negative counts from the end.
	 * @param int|null $length Length, negative trims from the end.
	 * @return string
	 */
	private static function slice( $text, $start, $length = null ) {
		if ( function_exists( 'mb_substr' ) ) {
			return null === $length ? mb_substr( $text, $start, null, 'UTF-8' ) : mb_substr( $text, $start, $length, 'UTF-8' );
		}

		return null === $length ? substr( $text, $start ) : substr( $text, $start, $length );
	}

	/**
	 * Suffix test.
	 *
	 * @param string $text   Text.
	 * @param string $suffix Suffix.
	 * @return bool
	 */
	private static function ends_with( $text, $suffix ) {
		if ( '' === $suffix ) {
			return true;
		}

		return substr( $text, -strlen( $suffix ) ) === $suffix;
	}
}
