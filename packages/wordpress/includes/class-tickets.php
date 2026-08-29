<?php
/**
 * Somewhere for a conversation to go when the agent cannot finish it.
 *
 * An assistant with no handoff is worse than no assistant: it tells a customer
 * it cannot help and the conversation ends there, with the shop never learning
 * that somebody wanted something.
 *
 * A post type rather than a table, so a site with no help desk still has a list
 * to read, a search box that works, and an export that already exists. A site
 * that does have one hooks `helpdeck_ticket_created` and forwards it.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * The ticket post type, and the action that writes to it.
 */
class Tickets {

	/**
	 * The post type name.
	 */
	const POST_TYPE = 'helpdeck_ticket';

	/**
	 * Registers the post type and the action.
	 *
	 * @return void
	 */
	public static function register() {
		add_action( 'init', array( __CLASS__, 'register_post_type' ) );
		add_filter( 'helpdeck_actions', array( __CLASS__, 'add_action' ) );
	}

	/**
	 * The post type.
	 *
	 * Not public: a ticket carries a customer's email address and their
	 * problem, and neither belongs on a URL anybody can guess or in a sitemap.
	 *
	 * @return void
	 */
	public static function register_post_type() {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'          => __( 'Support requests', 'helpdeck' ),
					'singular_name' => __( 'Support request', 'helpdeck' ),
					'menu_name'     => __( 'Support requests', 'helpdeck' ),
					'search_items'  => __( 'Search support requests', 'helpdeck' ),
					'not_found'     => __( 'No support requests yet.', 'helpdeck' ),
				),
				'public'              => false,
				'publicly_queryable'  => false,
				'exclude_from_search' => true,
				'show_ui'             => true,
				'show_in_menu'        => true,
				'menu_icon'           => 'dashicons-sos',
				'menu_position'       => 26,
				'capability_type'     => 'post',
				'supports'            => array( 'title', 'editor' ),
				'has_archive'         => false,
				'rewrite'             => false,
				'show_in_rest'        => false,
			)
		);
	}

	/**
	 * Adds the escalation action.
	 *
	 * @param array<string, array<string, mixed>> $actions Registered actions.
	 * @return array<string, array<string, mixed>>
	 */
	public static function add_action( $actions ) {
		$actions['create_support_request'] = array(
			'description' => 'Pass the conversation to a person. Use when you cannot answer, when the customer asks for a human, or when they are upset. Ask for their email first if you do not have it.',
			'fields'      => array(
				'email'   => array(
					'type'        => 'string',
					'description' => 'How to reach the customer back.',
					'required'    => true,
				),
				'summary' => array(
					'type'        => 'string',
					'description' => 'One or two sentences saying what they need, in your own words.',
					'required'    => true,
				),
				'name'    => array(
					'type'        => 'string',
					'description' => 'Their name, if they gave one.',
				),
			),
			'callback'    => array( __CLASS__, 'create' ),
		);

		return $actions;
	}

	/**
	 * Writes one ticket.
	 *
	 * @param array<string, mixed> $input   Arguments from the model.
	 * @param array<string, mixed> $context Conversation context.
	 * @return array<string, mixed>
	 */
	public static function create( $input, $context = array() ) {
		$email = isset( $input['email'] ) ? sanitize_email( (string) $input['email'] ) : '';

		if ( '' === $email || ! is_email( $email ) ) {
			return array( 'error' => 'a valid email address is needed first' );
		}

		$summary = isset( $input['summary'] ) ? sanitize_textarea_field( (string) $input['summary'] ) : '';

		if ( '' === trim( $summary ) ) {
			return array( 'error' => 'a short summary of the problem is needed' );
		}

		$name = isset( $input['name'] ) ? sanitize_text_field( (string) $input['name'] ) : '';

		$id = wp_insert_post(
			array(
				'post_type'    => self::POST_TYPE,
				'post_status'  => 'publish',
				/* translators: %s: the customer's email address. */
				'post_title'   => sprintf( __( 'Request from %s', 'helpdeck' ), '' !== $name ? $name : $email ),
				'post_content' => $summary,
				'meta_input'   => array(
					'helpdeck_email'        => $email,
					'helpdeck_name'         => $name,
					'helpdeck_conversation' => isset( $context['conversation'] ) ? (string) $context['conversation'] : '',
				),
			),
			true
		);

		if ( is_wp_error( $id ) ) {
			return array( 'error' => 'that could not be saved' );
		}

		/**
		 * Fires when the agent hands a conversation to a person.
		 *
		 * Where a site forwards it to a real help desk, sends an email, or
		 * pushes it into whatever the shop already uses.
		 *
		 * @param int                  $id      The ticket post id.
		 * @param array<string, mixed> $ticket  Email, name and summary.
		 * @param array<string, mixed> $context Conversation context.
		 */
		do_action(
			'helpdeck_ticket_created',
			$id,
			array(
				'email'   => $email,
				'name'    => $name,
				'summary' => $summary,
			),
			$context
		);

		// The reference is the post id, which is what somebody reading the
		// admin list will see, so the customer and the shop are looking at the
		// same number.
		return array(
			'created'   => true,
			'reference' => $id,
		);
	}
}
