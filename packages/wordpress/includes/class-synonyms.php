<?php
/**
 * The words a customer uses, against the words the page was written in.
 *
 * The mirror of the TypeScript side, and it has to stay one: the two are held
 * to the same output by generated fixtures, and a query that expands here and
 * not there means a site running the plugin retrieves different pages from the
 * same question.
 *
 * Applied to the question, never to the pages, so it can be corrected without
 * rebuilding an index.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Expands a question with the words a page might have used instead.
 */
class Synonyms {

	/**
	 * Words that mean the same thing to somebody asking a support question.
	 *
	 * Any member found in a question brings in the rest. Deliberately short:
	 * every entry is a guess about somebody else's content, and a wrong guess
	 * pulls the wrong page to the top of a real customer's answer.
	 *
	 * English only. A business writing in another language passes its own.
	 *
	 * @var array<int, array<int, string>>
	 */
	const GROUPS = array(
		array( 'refund', 'money back', 'reimburse' ),
		array( 'delivery', 'shipping', 'postage' ),
		array( 'broken', 'faulty', 'damaged', 'defective' ),
		array( 'cancel', 'cancellation' ),
		array( 'invoice', 'receipt', 'bill' ),
		array( 'password', 'passcode', 'log in', 'login', 'sign in' ),
	);

	/**
	 * The question, plus the words the pages might have used instead.
	 *
	 * Added rather than substituted: the customer's own words are usually
	 * right, and a page using them should still win on the count of matched
	 * terms.
	 *
	 * @param string                               $query The question.
	 * @param array<int, array<int, string>>|false $extra Extra groups, or false to disable.
	 * @return string
	 */
	public static function expand( $query, $extra = array() ) {
		if ( false === $extra ) {
			return $query;
		}

		$groups = array_merge( self::GROUPS, is_array( $extra ) ? $extra : array() );
		$added  = array();

		foreach ( $groups as $group ) {
			foreach ( $group as $phrase ) {
				$others = array_values( array_diff( $group, array( $phrase ) ) );

				if ( empty( $others ) ) {
					continue;
				}

				// Whole words only. Without the boundaries "bill" matches
				// "billing address" and "login" matches "logging", and both add
				// terms that pull the wrong page up.
				$pattern = '/\b' . preg_quote( $phrase, '/' ) . '\b/i';

				if ( 1 === preg_match( $pattern, $query ) ) {
					$added[] = implode( ' ', $others );
				}
			}
		}

		if ( empty( $added ) ) {
			return $query;
		}

		return $query . ' ' . implode( ' ', $added );
	}
}
