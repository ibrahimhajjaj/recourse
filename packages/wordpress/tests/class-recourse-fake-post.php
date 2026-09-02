<?php
/**
 * Stands in for WP_Post, which is all the content gate reads before deciding.
 *
 * @package Recourse
 */

declare(strict_types=1);

/**
 * The fields the gate reads before it decides.
 *
 * The body is one of them, and it used to be missing. Reading a property that
 * is not there is a warning on PHP 8 and PHPUnit turns warnings into
 * exceptions, so the gate test caught one and read it as "the post got past
 * the gate". On PHP 7.4 the same thing is a notice, nothing was thrown, and
 * the test failed on a gate that was behaving identically.
 */
final class Recourse_Fake_Post {

	/**
	 * Post status.
	 *
	 * @var string
	 */
	public $post_status = 'publish';

	/**
	 * Password, empty when there is none.
	 *
	 * @var string
	 */
	public $post_password = '';

	/**
	 * The body, which the gate renders and refuses when it comes out empty.
	 *
	 * @var string
	 */
	public $post_content = '<p>We refund any order within 30 days of delivery.</p>';

	/**
	 * Post type, which the document id is built from.
	 *
	 * @var string
	 */
	public $post_type = 'post';

	/**
	 * Post id, the other half of the document id.
	 *
	 * @var int
	 */
	public $ID = 1;

	/**
	 * Builds a post in whatever state the gate is being asked about.
	 *
	 * @param string $status   Post status.
	 * @param string $password Post password.
	 * @param string $content  Post body.
	 * @return void
	 */
	public function __construct( string $status = 'publish', string $password = '', ?string $content = null ) {
		$this->post_status   = $status;
		$this->post_password = $password;

		if ( null !== $content ) {
			$this->post_content = $content;
		}
	}
}
