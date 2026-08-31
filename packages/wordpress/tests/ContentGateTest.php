<?php
/**
 * What may be indexed, which is the plugin's security boundary.
 *
 * Two abilities answer questions from the index with `__return_true` as their
 * permission callback, and that is only defensible because the index holds
 * nothing a logged out visitor could not already read. Everything downstream
 * rests on this gate: if a draft reaches the index, the agent will quote it to
 * anybody who asks the right question, and nothing will report that it did.
 *
 * @package Recourse
 */

declare(strict_types=1);

use Recourse\Content;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/class-recourse-fake-post.php';

/**
 * The gate that decides what may be indexed.
 */
final class ContentGateTest extends TestCase {

	/**
	 * Every status WordPress ships that is not public.
	 *
	 * @return void
	 */
	public function test_nothing_unpublished_becomes_a_document(): void {
		foreach ( array( 'draft', 'pending', 'private', 'future', 'trash', 'auto-draft', 'inherit' ) as $status ) {
			$this->assertNull(
				Content::to_document( new Recourse_Fake_Post( $status ) ),
				"a {$status} post was allowed into the index"
			);
		}
	}

	/**
	 * A password is the author saying this is for people who have it, and the
	 * agent has no way to ask a visitor for one.
	 *
	 * @return void
	 */
	public function test_a_password_protected_post_is_refused_even_when_published(): void {
		$this->assertNull( Content::to_document( new Recourse_Fake_Post( 'publish', 'secret' ) ) );
	}

	/**
	 * The gate has to let published content through, or the test above would
	 * pass just as well with a function that always returned null.
	 *
	 * @return void
	 */
	public function test_a_published_post_is_not_refused_by_the_gate(): void {
		$refused = false;

		// Past the gate it needs the post body, the title and the permalink,
		// none of which exist without WordPress. So the proof that a published
		// post was allowed through is that it got far enough to fail on one of
		// those, rather than quietly returning null. The assertion is kept
		// outside the try, or a failed assertion would be caught as the very
		// throwable it is looking for and the test would pass either way.
		try {
			$refused = null === Content::to_document( new Recourse_Fake_Post( 'publish' ) );
		} catch ( \Throwable $error ) {
			$refused = false;
		}

		$this->assertFalse( $refused, 'the gate refused a published post' );
	}
}
