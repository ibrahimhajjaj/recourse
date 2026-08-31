<?php
/**
 * That the two halves of the tone feature agree on what a tone is.
 *
 * One half decides whether a pasted tone is worth storing, the other turns a
 * stored tone into rules. When they disagree the paste is accepted and does
 * nothing, or rejected and vanishes, and either way the box is cleared on the
 * next page load with nothing said.
 *
 * @package Recourse
 */

declare(strict_types=1);

namespace Recourse\Tests;

use Recourse\Prompt;
use Recourse\Settings;
use PHPUnit\Framework\TestCase;

/**
 * The stored tone, and the rules built from it.
 */
final class SettingsToneTest extends TestCase {

	/**
	 * Runs a pasted tone through the sanitiser the settings screen uses.
	 *
	 * @param string $written What somebody pasted into the box.
	 * @return string What is stored.
	 */
	private function stored( string $written ): string {
		$saved = Settings::sanitize(
			array(
				'persona' => array(
					'tone'         => 'plain',
					'tone_written' => $written,
				),
			)
		);

		return $saved['persona']['tone'];
	}

	/**
	 * Asterisks are the other bullet markdown has, and the prompt builder has
	 * always accepted them.
	 *
	 * @return void
	 */
	public function test_a_tone_written_with_asterisks_survives_being_saved(): void {
		$written = "* Assume they are reading on a phone.\n* Lead with the fix.";

		$this->assertSame( $written, $this->stored( $written ) );
		$this->assertStringContainsString(
			'reading on a phone',
			Prompt::instructions( array(), array( 'tone' => $this->stored( $written ) ) )
		);
	}

	/**
	 * A dash inside a word is not a rule, and storing prose because it
	 * contains one produces a tone with nothing in it.
	 *
	 * @return void
	 */
	public function test_prose_with_a_hyphen_in_it_is_not_a_tone(): void {
		$this->assertSame( 'plain', $this->stored( 'Please be well-written and friendly.' ) );
	}

	/**
	 * The format the placeholder shows has to keep working.
	 *
	 * @return void
	 */
	public function test_a_dash_bulleted_tone_still_survives(): void {
		$written = "- Assume they are reading on a phone.\n- Lead with the fix.";
		$this->assertSame( $written, $this->stored( $written ) );
	}

	/**
	 * Clearing the box goes back to the tone selected above it, which is the
	 * only route back now that the checkbox beside it is gone.
	 *
	 * @return void
	 */
	public function test_an_empty_box_falls_back_to_the_chosen_tone(): void {
		$saved = Settings::sanitize(
			array(
				'persona' => array(
					'tone'         => 'brisk',
					'tone_written' => '   ',
				),
			)
		);

		$this->assertSame( 'brisk', $saved['persona']['tone'] );
	}
}
