<?php
/**
 * The gate that decides which actions reach the model on a given turn.
 *
 * @package Recourse
 */

namespace Recourse\Tests;

use Recourse\Relevance;
use PHPUnit\Framework\TestCase;

/**
 * Holding an action back until the conversation is about it.
 */
class RelevanceTest extends TestCase {

	/**
	 * An action for the gate to judge.
	 *
	 * @param string $about What it is for, or '' for an ungated action.
	 * @return array<string, mixed>
	 */
	private function action( $about = '' ) {
		$action = array(
			'description' => 'do a thing',
			'callback'    => '__return_true',
			'fields'      => array(),
		);

		if ( '' !== $about ) {
			$action['relevant_when'] = $about;
		}

		return $action;
	}

	/**
	 * An action nothing gates is always offered.
	 *
	 * @return void
	 */
	public function test_ungated_action_is_always_offered() {
		$actions = array( 'collect_lead' => $this->action() );

		$this->assertSame( $actions, Relevance::offered( $actions, 'where is my parcel' ) );
	}

	/**
	 * An action the conversation is not about is held back.
	 *
	 * @return void
	 */
	public function test_unrelated_action_is_held_back() {
		$actions = array( 'check_stock' => $this->action( 'stock availability sizes' ) );

		$this->assertSame( array(), Relevance::offered( $actions, 'where is my parcel' ) );
	}

	/**
	 * And offered once the conversation turns to it.
	 *
	 * @return void
	 */
	public function test_related_action_is_offered() {
		$actions = array( 'check_stock' => $this->action( 'stock availability sizes' ) );

		$this->assertSame(
			array( 'check_stock' ),
			array_keys( Relevance::offered( $actions, 'is it in stock' ) )
		);
	}

	/**
	 * Nothing to judge means nothing is taken away.
	 *
	 * A one-shot question with no conversation behind it must not silently lose
	 * the actions it needs.
	 *
	 * @return void
	 */
	public function test_empty_conversation_offers_everything() {
		$actions = array( 'check_stock' => $this->action( 'stock availability sizes' ) );

		$this->assertSame( $actions, Relevance::offered( $actions, '' ) );
		$this->assertSame( $actions, Relevance::offered( $actions, '   ' ) );
	}

	/**
	 * A phrase of nothing but support vocabulary is not a filter.
	 *
	 * @return void
	 */
	public function test_phrase_with_nothing_distinctive_matches_everything() {
		$actions = array( 'anything' => $this->action( 'the customer order' ) );

		$this->assertSame(
			array( 'anything' ),
			array_keys( Relevance::offered( $actions, 'what are your opening hours' ) )
		);
	}
}
