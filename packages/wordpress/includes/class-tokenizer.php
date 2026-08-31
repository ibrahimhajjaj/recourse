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

		// Splitting on anything that is not a letter or a digit, by Unicode
		// property rather than by a Latin range, so Arabic and CJK content
		// tokenises instead of being thrown away.
		$parts = preg_split( '/[^\p{L}\p{N}]+/u', self::lower( $text ) );

		if ( false === $parts ) {
			return $out;
		}

		foreach ( $parts as $raw ) {
			$length = self::length( $raw );

			if ( $length < 2 || $length > 40 ) {
				continue;
			}
			if ( isset( $stopwords[ $raw ] ) ) {
				continue;
			}

			$out[] = self::stem( $raw );
		}

		return $out;
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
