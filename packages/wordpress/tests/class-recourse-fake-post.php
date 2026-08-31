<?php
/**
 * Stands in for WP_Post, which is all the content gate reads before deciding.
 *
 * @package Recourse
 */

declare(strict_types=1);

/**
 * The two fields the gate looks at, and nothing else.
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
	 * Builds a post in whatever state the gate is being asked about.
	 *
	 * @param string $status   Post status.
	 * @param string $password Post password.
	 * @return void
	 */
	public function __construct( string $status = 'publish', string $password = '' ) {
		$this->post_status   = $status;
		$this->post_password = $password;
	}
}
