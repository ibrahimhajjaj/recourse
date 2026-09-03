<?php
/**
 * What the answer ability is allowed to do.
 *
 * It is annotated readonly, not destructive and idempotent, and callers
 * decide whether to trust it on the strength of that. This is the test that
 * the annotation is true.
 *
 * @package Recourse
 */

namespace Recourse\Tests;

use Recourse\Relevance;
use PHPUnit\Framework\TestCase;

/**
 * A read-only caller must reach no action at all.
 */
class ReadOnlyAbilityTest extends TestCase {

	/**
	 * An action that writes, of the kind opening a ticket registers.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	private function writing_action() {
		return array(
			'open_ticket' => array(
				'description' => 'Open a support ticket.',
				'callback'    => '__return_true',
				'fields'      => array(),
			),
		);
	}

	/**
	 * The behaviour that made the ability's annotation a lie.
	 *
	 * An empty topic does not mean "no actions", it means "nothing to narrow
	 * by", so every action is offered. A caller that will not act therefore
	 * has to say so rather than pass an empty string and hope.
	 */
	public function test_an_empty_topic_offers_every_action() {
		$offered = Relevance::offered( $this->writing_action(), '' );

		$this->assertArrayHasKey( 'open_ticket', $offered );
	}

	/**
	 * A topic that has nothing to do with the action still offers it when the
	 * action declares no `relevant_when`, which is why the topic alone was
	 * never a safe way to keep a writing action away from a reader.
	 */
	public function test_an_unrelated_topic_offers_an_ungated_action_too() {
		$offered = Relevance::offered( $this->writing_action(), 'what are your opening hours' );

		$this->assertArrayHasKey( 'open_ticket', $offered );
	}

	/**
	 * A read-only caller passes `false`, and that path builds no tools at all.
	 */
	public function test_the_read_only_path_offers_nothing() {
		$model = file_get_contents( dirname( __DIR__ ) . '/includes/class-model.php' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.

		$this->assertStringContainsString(
			'$actions = $may_act ? Relevance::offered( Actions::all(), $about ) : array();',
			$model,
			'Model::answer must be able to run with no actions at all'
		);
	}

	/**
	 * And the answer ability is a caller that asks for it.
	 *
	 * Asserted against the source because the alternative is booting WordPress
	 * and a model. What this guards is somebody deleting the argument later
	 * and quietly handing every registered action back to an anonymous caller.
	 */
	public function test_the_answer_ability_asks_for_the_read_only_path() {
		$abilities = file_get_contents( dirname( __DIR__ ) . '/includes/class-abilities.php' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.

		$call = substr( $abilities, strpos( $abilities, '$result = Model::answer(' ) );
		$call = substr( $call, 0, strpos( $call, ');' ) );

		$this->assertStringContainsString(
			'false',
			$call,
			'Abilities::answer must pass $may_act as false'
		);
		$this->assertStringNotContainsString(
			'Actions::all()',
			$call,
			'Abilities::answer must not tell the prompt it has actions it will not be given'
		);
	}
}
