<?php
/**
 * The action names must not reach a customer.
 *
 * Measured before this existed: asked to list its tools, the model named all
 * three. The prompt now discourages it and this makes it impossible, which is
 * the right order of reliance. A rule a model can decline to follow is not a
 * control.
 *
 * @package Recourse
 */

namespace Recourse\Tests;

use Recourse\Actions;
use PHPUnit\Framework\TestCase;

/**
 * Redacting action names from an answer.
 */
class RedactionTest extends TestCase {

	/**
	 * The actions to redact.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	private function actions() {
		return array(
			'look_up_order'          => array( 'description' => 'x' ),
			'check_stock'            => array( 'description' => 'x' ),
			'create_support_request' => array( 'description' => 'x' ),
		);
	}

	/**
	 * An ordinary answer is untouched.
	 *
	 * @return void
	 */
	public function test_a_normal_answer_passes_through() {
		$answer = 'Your order is on its way and should arrive on Thursday [1].';

		$this->assertSame( $answer, Actions::redact( $answer, $this->actions() ) );
	}

	/**
	 * The measured failure.
	 *
	 * @return void
	 */
	public function test_an_enumerated_tool_list_is_replaced() {
		$leak = 'I have access to the following tools and functions: create_support_request, look_up_order, and check_stock.';
		$safe = Actions::redact( $leak, $this->actions() );

		$this->assertNotSame( $leak, $safe );
		$this->assertStringNotContainsString( 'look_up_order', $safe );
		$this->assertStringNotContainsString( 'check_stock', $safe );
		$this->assertStringNotContainsString( 'create_support_request', $safe );
	}

	/**
	 * One name in the middle of a sentence is enough.
	 *
	 * @return void
	 */
	public function test_a_single_name_anywhere_is_enough() {
		$safe = Actions::redact( 'Let me call look_up_order for you.', $this->actions() );

		$this->assertStringNotContainsString( 'look_up_order', $safe );
	}

	/**
	 * Case does not save it.
	 *
	 * @return void
	 */
	public function test_the_check_is_not_case_sensitive() {
		$safe = Actions::redact( 'I will use Look_Up_Order now.', $this->actions() );

		$this->assertStringNotContainsString( 'ook_Up_Order', $safe );
	}

	/**
	 * The replacement is not itself a redaction notice.
	 *
	 * Telling the reader something was removed tells them there was something
	 * worth removing.
	 *
	 * @return void
	 */
	public function test_the_replacement_reads_like_an_answer() {
		$safe = Actions::redact( 'Tools: look_up_order.', $this->actions() );

		$this->assertStringNotContainsString( 'redact', strtolower( $safe ) );
		$this->assertStringNotContainsString( '[removed]', strtolower( $safe ) );
		$this->assertStringContainsString( 'help', strtolower( $safe ) );
	}

	/**
	 * With no actions there is nothing to hide.
	 *
	 * @return void
	 */
	public function test_no_actions_means_no_redaction() {
		$answer = 'We are open until six.';

		$this->assertSame( $answer, Actions::redact( $answer, array() ) );
	}
}
