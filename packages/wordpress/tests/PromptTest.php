<?php
/**
 * The shape of the prompt, and that it matches the TypeScript one.
 *
 * Six live defects over one evening turned out to be a single defect wearing
 * six hats: a global line saying "when you cannot answer, say this and stop",
 * sitting at the same level as every other rule and winning, because a
 * sentence that broad wins every argument it is allowed to have. A greeting
 * got it. "Are you human" got it. Three questions in one message got one of
 * it. A password request got it, worded as a failed lookup.
 *
 * Each was patched with an exception fencing the fallback off. The fallback
 * now lives inside the one branch it belongs to and cannot reach the others,
 * so these assert containment rather than ordering, and the exceptions the
 * patches added are gone.
 *
 * @package Helpdeck
 */

namespace Helpdeck\Tests;

use Helpdeck\Prompt;
use PHPUnit\Framework\TestCase;

/**
 * Structure of the built prompt.
 */
class PromptTest extends TestCase {

	/**
	 * A prompt with a marker where the fallback goes, so it can be counted.
	 *
	 * @param  bool $has_actions Whether the agent has actions.
	 * @return string
	 */
	private function built( $has_actions = false ) {
		return Prompt::instructions( array(), array( 'fallback' => 'FALLBACK_MARKER' ), $has_actions );
	}

	/**
	 * Said once, and only where it belongs.
	 */
	public function test_the_fallback_is_named_once_inside_the_lookup_step() {
		$instructions = $this->built();

		$this->assertSame( 1, substr_count( $instructions, 'FALLBACK_MARKER' ) );
		$this->assertGreaterThan(
			strpos( $instructions, '4. Asking something you could look up' ),
			strpos( $instructions, 'FALLBACK_MARKER' )
		);
	}

	/**
	 * Still contained when actions exist, which is the branch that ships.
	 */
	public function test_it_stays_in_the_lookup_step_with_actions() {
		$instructions = $this->built( true );

		$this->assertSame( 1, substr_count( $instructions, 'FALLBACK_MARKER' ) );
		$this->assertGreaterThan(
			strpos( $instructions, '4. Asking something you could look up' ),
			strpos( $instructions, 'FALLBACK_MARKER' )
		);
	}

	/**
	 * Each thing that used to be refused is a branch of its own.
	 */
	public function test_every_defect_became_a_branch() {
		$instructions = $this->built();

		$this->assertStringContainsString( '1. Saying hello, thank you or goodbye', $instructions );
		$this->assertStringContainsString( '2. Asking about you', $instructions );
		$this->assertStringContainsString( '3. Asking for something you will never do', $instructions );
		$this->assertStringContainsString( '4. Asking something you could look up', $instructions );
	}

	/**
	 * Twice, at both ends, because this is the one a regulator cares about.
	 */
	public function test_it_says_what_it_is_in_the_opening_line_and_again_in_its_branch() {
		$instructions = $this->built();
		$opening      = strtok( $instructions, "\n" );

		$this->assertStringContainsString( 'AI assistant', $opening );
		$this->assertGreaterThan( strlen( $opening ), strpos( $instructions, 'never a human' ) );
	}

	/**
	 * One part of a message does not decide the answer to another.
	 */
	public function test_each_part_of_a_message_is_handled_alone() {
		$this->assertStringContainsString( 'handle each part on its own', $this->built() );
	}

	/**
	 * Live: "please contact us for password assistance", to somebody who was
	 * contacting us. Written as a concept it was ignored; quoted it held.
	 */
	public function test_the_banned_phrases_are_quoted_rather_than_described() {
		$instructions = $this->built();

		foreach ( array( 'contact us', 'reach out to us', 'get in touch with us' ) as $phrase ) {
			$this->assertStringContainsString( '"' . $phrase . '"', $instructions );
		}
	}

	/**
	 * One word becomes rules that change sentences.
	 */
	public function test_a_tone_is_rules_not_a_label() {
		$brisk  = Prompt::instructions( array(), array( 'tone' => 'brisk' ) );
		$formal = Prompt::instructions( array(), array( 'tone' => 'formal' ) );

		$this->assertStringContainsString( 'shortest correct answer', $brisk );
		$this->assertStringContainsString( 'no contractions', $formal );
		$this->assertStringNotContainsString( 'no contractions', $brisk );
	}

	/**
	 * No tone chosen says nothing about tone.
	 */
	public function test_no_tone_adds_no_rules() {
		$instructions = Prompt::instructions( array() );

		$this->assertStringNotContainsString( 'shortest correct answer', $instructions );
		$this->assertStringNotContainsString( 'no contractions', $instructions );
	}

	/**
	 * A typo is not a reason to stop answering anybody.
	 */
	public function test_an_unknown_tone_is_ignored() {
		$this->assertStringContainsString(
			'1. Saying hello',
			Prompt::instructions( array(), array( 'tone' => 'freindly' ) )
		);
	}

	/**
	 * A tone somebody else wrote, pasted in whole.
	 */
	public function test_a_written_tone_is_read_from_its_bullets() {
		$written = "# Night shift\n\nWritten for a team answering at 3am.\n\n- Assume they are tired and reading on a phone.\n* Lead with the fix. Explanation second.\n";

		$instructions = Prompt::instructions( array(), array( 'tone' => $written ) );

		$this->assertStringContainsString( 'Assume they are tired', $instructions );
		$this->assertStringContainsString( 'Lead with the fix', $instructions );
		// The prose around the bullets is documentation, not instruction.
		$this->assertStringNotContainsString( 'Night shift', $instructions );
		$this->assertStringNotContainsString( '3am', $instructions );
	}

	/**
	 * A pasted essay cannot quietly become the system prompt.
	 */
	public function test_a_written_tone_is_capped() {
		$rules = array();
		for ( $index = 0; $index < 40; $index++ ) {
			$rules[] = '- rule number ' . $index;
		}

		$instructions = Prompt::instructions( array(), array( 'tone' => implode( "\n", $rules ) ) );

		$this->assertStringContainsString( 'rule number 11', $instructions );
		$this->assertStringNotContainsString( 'rule number 12', $instructions );
	}

	/**
	 * The exceptions survive where retrieval found nothing.
	 */
	public function test_the_exceptions_outlive_an_empty_retrieval() {
		$instructions = Prompt::instructions( array() );
		$no_sources   = strpos( $instructions, 'There are no sources for this question' );
		$survives     = strpos( $instructions, 'still answered as set out above' );

		$this->assertNotFalse( $no_sources );
		$this->assertNotFalse( $survives );
		$this->assertGreaterThan( $no_sources, $survives );
	}

	/**
	 * Every line the TypeScript prompt has, this one has too.
	 *
	 * The two implementations are edited by hand because the plugin runs on
	 * shared PHP hosting with no Node. On this test's first run it found four
	 * divergences nobody could have caught by reading, including a rule the
	 * composed PHP prompt emitted twice.
	 *
	 * Wording and order are both compared. Order is what broke first.
	 */
	public function test_the_prompt_matches_the_typescript_one() {
		$path = __DIR__ . '/fixtures/parity.json';
		$this->assertFileExists( $path, 'Run `node tools/generate-parity-fixtures.mjs` first.' );

		$fixture = json_decode( file_get_contents( $path ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a fixture on disk, in a test that does not load WordPress.
		$this->assertArrayHasKey( 'prompt', $fixture, 'regenerate the fixture' );

		// Composed the way the plugin composes it. The action rules live in
		// Actions rather than Prompt on this side, so comparing only the
		// prompt would quietly skip eight rules, which is where two of the
		// four drifts found on the first run were hiding.
		$actions = array( 'look_up_order' => array( 'description' => 'when they ask about an order' ) );

		$built = array(
			'bare'        => Prompt::instructions( array() ),
			'withActions' => Prompt::instructions( array(), array(), true ) . \Helpdeck\Actions::instructions( $actions ),
			'brisk'       => Prompt::instructions( array(), array( 'tone' => 'brisk' ) ),
		);

		foreach ( $fixture['prompt'] as $name => $expected ) {
			$this->assertSame(
				$expected,
				$this->lines( $built[ $name ] ),
				"the {$name} prompt has drifted from the TypeScript one"
			);
		}
	}

	/**
	 * The instruction lines of a prompt: the numbered steps and the dashed rules.
	 *
	 * @param  string $instructions A built prompt.
	 * @return array<int, string>
	 */
	private function lines( $instructions ) {
		$kept = array();
		foreach ( preg_split( '/\R/', $instructions ) as $line ) {
			$line = trim( $line );
			if ( 0 === strpos( $line, '- ' ) || preg_match( '/^\d+\. /', $line ) ) {
				$kept[] = $line;
			}
		}

		return $kept;
	}
}
