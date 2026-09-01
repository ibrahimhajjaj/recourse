<?php
/**
 * Whether a conversation is about a particular thing.
 *
 * Used to decide whether an action is worth putting in front of the model on
 * this turn. Every action's name, description and inputs are sent on every
 * message, whether or not the conversation has anything to do with them, and a
 * small model choosing between twenty tools chooses worse than one choosing
 * between three.
 *
 * Deliberately generous. A missed match takes something away from a turn that
 * needed it, which breaks a working site; a loose match only leaves things as
 * they were. So one shared distinctive word is enough, and a phrase with no
 * distinctive words matches everything.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Matches a phrase against what is being said.
 */
class Relevance {

	/**
	 * Support vocabulary that says nothing about which of them applies.
	 *
	 * Nearly every phrase contains some of these, so matching on one matches
	 * everything: "where is my order" would turn on a refund action because
	 * both mention an order. The general stopword list does not cover them
	 * because they carry plenty of meaning in a document; they just carry none
	 * here.
	 *
	 * Stemmed, because that is what the tokeniser returns.
	 *
	 * @var array<int, string>
	 */
	const GENERIC = array(
		'custom',
		'customer',
		'client',
		'user',
		'account',
		'order',
		'purchas',
		'item',
		'product',
		'request',
		'ask',
		'want',
		'need',
		'help',
		'support',
		'question',
		'issu',
		'problem',
		'about',
		'their',
		'them',
		'someth',
		'anyth',
	);

	/**
	 * Whether `$conversation` shares a distinctive word with `$about`.
	 *
	 * @param string $about        A few words describing what something is for.
	 * @param string $conversation Everything said, and whatever retrieval found.
	 * @return bool
	 */
	public static function mentions( $about, $conversation ) {
		$generic = array_flip( self::GENERIC );
		$wanted  = array();

		foreach ( Tokenizer::tokenize( (string) $about ) as $term ) {
			if ( ! isset( $generic[ $term ] ) ) {
				$wanted[ $term ] = true;
			}
		}

		// Nothing distinctive to match on, so this is not a filter and does not
		// pretend to be one.
		if ( empty( $wanted ) ) {
			return true;
		}

		foreach ( Tokenizer::tokenize( (string) $conversation ) as $term ) {
			if ( isset( $wanted[ $term ] ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * The actions worth offering on this turn.
	 *
	 * An action without `relevant_when` is always offered, which is the right
	 * default: one the model cannot see is one it cannot use.
	 *
	 * @param array<string, array<string, mixed>> $actions      Keyed by action name.
	 * @param string                              $conversation Everything said, and whatever retrieval found.
	 * @return array<string, array<string, mixed>>
	 */
	public static function offered( $actions, $conversation ) {
		if ( ! is_array( $actions ) || '' === trim( (string) $conversation ) ) {
			return is_array( $actions ) ? $actions : array();
		}

		$offered = array();

		foreach ( $actions as $name => $action ) {
			$about = isset( $action['relevant_when'] ) ? (string) $action['relevant_when'] : '';

			if ( '' === $about || self::mentions( $about, $conversation ) ) {
				$offered[ $name ] = $action;
			}
		}

		return $offered;
	}
}
