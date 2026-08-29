<?php
/**
 * The bridge to WordPress's own Abilities API.
 *
 * Core has had a registry of callable abilities since 6.9, and plugins use it:
 * a stock WooCommerce registers seven, and core registers three of its own.
 * Anything registered there is already described with a JSON Schema and a
 * permission callback, which is exactly what a model needs to call it.
 *
 * It works both ways here. This plugin's own actions are registered as
 * abilities, so any other agent on the site can use them, and abilities
 * registered by anybody else can be offered to the agent as tools.
 *
 * **Nothing is offered unless the site names it.** That is not caution for its
 * own sake. The seven WooCommerce registers include `product-delete` and
 * `order-update-status`, and the visitor at the other end of this chat is an
 * anonymous member of the public. An allowlist is the only defensible default,
 * and an ability annotated as destructive is refused even when named.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes the core ability registry.
 */
class Abilities {

	/**
	 * The category this plugin's abilities live in.
	 */
	const CATEGORY = 'helpdeck';

	/**
	 * Whether this WordPress has the Abilities API.
	 *
	 * @return bool
	 */
	public static function supported() {
		return function_exists( 'wp_register_ability' )
			&& function_exists( 'wp_get_abilities' )
			&& function_exists( 'wp_get_ability' );
	}

	/**
	 * Hooks registration up.
	 *
	 * @return void
	 */
	public static function register() {
		if ( ! self::supported() ) {
			return;
		}

		add_action( 'wp_abilities_api_categories_init', array( __CLASS__, 'register_category' ) );
		add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_abilities' ) );
	}

	/**
	 * The category.
	 *
	 * @return void
	 */
	public static function register_category() {
		if ( ! function_exists( 'wp_register_ability_category' ) ) {
			return;
		}

		wp_register_ability_category(
			self::CATEGORY,
			array(
				'label'       => __( 'Support assistant', 'helpdeck' ),
				'description' => __( 'Answering visitor questions from the site\'s own content.', 'helpdeck' ),
			)
		);
	}

	/**
	 * Publishes this plugin's actions as abilities.
	 *
	 * Registered but not exposed: `public` stays false, so an ability is
	 * reachable from PHP and from this plugin's own agent, and reaches the REST
	 * API or an MCP client only if the site says so.
	 *
	 * @return void
	 */
	public static function register_abilities() {
		wp_register_ability(
			'helpdeck/answer',
			array(
				'label'               => __( 'Answer from the site content', 'helpdeck' ),
				'description'         => __( 'Answer a question using the site\'s published pages, and return the answer with the sources it came from.', 'helpdeck' ),
				'category'            => self::CATEGORY,
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'question' => array(
							'type'        => 'string',
							'description' => __( 'The question to answer.', 'helpdeck' ),
						),
					),
					'required'   => array( 'question' ),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'answer'  => array( 'type' => 'string' ),
						'sources' => array( 'type' => 'array' ),
					),
				),
				'execute_callback'    => array( __CLASS__, 'answer' ),
				// Anything the site already publishes. The retrieval path
				// refuses drafts and private posts before this is reached.
				'permission_callback' => '__return_true',
				'meta'                => array(
					'annotations' => array(
						'readonly'    => true,
						'destructive' => false,
						'idempotent'  => true,
					),
					'public'      => false,
				),
			)
		);

		wp_register_ability(
			'helpdeck/search',
			array(
				'label'               => __( 'Search the site content', 'helpdeck' ),
				'description'         => __( 'Find the passages of published content that match a question, without calling a model.', 'helpdeck' ),
				'category'            => self::CATEGORY,
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'query' => array(
							'type'        => 'string',
							'description' => __( 'What to search for.', 'helpdeck' ),
						),
					),
					'required'   => array( 'query' ),
				),
				'execute_callback'    => array( __CLASS__, 'search' ),
				'permission_callback' => '__return_true',
				'meta'                => array(
					'annotations' => array(
						'readonly'    => true,
						'destructive' => false,
						'idempotent'  => true,
					),
					'public'      => false,
				),
			)
		);
	}

	/**
	 * The answer ability.
	 *
	 * @param array<string, mixed> $input Input matching the schema.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function answer( $input = array() ) {
		$question = isset( $input['question'] ) ? sanitize_text_field( (string) $input['question'] ) : '';

		if ( '' === $question ) {
			return new \WP_Error( 'helpdeck_no_question', __( 'A question is required.', 'helpdeck' ) );
		}

		$index = Storage::load();

		if ( null === $index ) {
			return new \WP_Error( 'helpdeck_no_index', __( 'The index has not been built.', 'helpdeck' ) );
		}

		$matches  = Retriever::retrieve( $index, $question );
		$settings = Settings::all();

		$result = Model::answer(
			Prompt::instructions( $matches, $settings['persona'] ),
			array(
				array(
					'role'    => 'user',
					'content' => $question,
				),
			),
			$settings['model']
		);

		if ( ! $result['ok'] ) {
			return new \WP_Error( 'helpdeck_no_answer', $result['error'] );
		}

		return array(
			'answer'  => $result['text'],
			'sources' => Prompt::sources( $matches ),
		);
	}

	/**
	 * The search ability. No model, no credential, no cost.
	 *
	 * @param array<string, mixed> $input Input matching the schema.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function search( $input = array() ) {
		$query = isset( $input['query'] ) ? sanitize_text_field( (string) $input['query'] ) : '';

		if ( '' === $query ) {
			return new \WP_Error( 'helpdeck_no_query', __( 'A query is required.', 'helpdeck' ) );
		}

		$index = Storage::load();

		if ( null === $index ) {
			return new \WP_Error( 'helpdeck_no_index', __( 'The index has not been built.', 'helpdeck' ) );
		}

		$passages = array();

		foreach ( Retriever::retrieve( $index, $query ) as $match ) {
			$passages[] = array(
				'title' => isset( $match['chunk']['title'] ) ? $match['chunk']['title'] : '',
				'url'   => isset( $match['chunk']['url'] ) ? $match['chunk']['url'] : '',
				'text'  => isset( $match['chunk']['text'] ) ? $match['chunk']['text'] : '',
			);
		}

		return array( 'passages' => $passages );
	}

	/**
	 * Abilities the site has allowed the agent to call, as actions.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public static function as_actions() {
		if ( ! self::supported() ) {
			return array();
		}

		/**
		 * Filters which registered abilities the agent may call.
		 *
		 * Names as registered, for example `woocommerce/products-query`. Empty
		 * by default, and deliberately so: the visitor at the other end of the
		 * chat is anonymous, and a stock WooCommerce registers abilities that
		 * delete products and change order status.
		 *
		 * @param array<int, string> $names Ability names.
		 */
		$allowed = apply_filters( 'helpdeck_allowed_abilities', array() );

		if ( ! is_array( $allowed ) || empty( $allowed ) ) {
			return array();
		}

		$actions = array();

		foreach ( $allowed as $name ) {
			// Guarded at the call rather than only in `supported()` above: the
			// directory's scanner reads this statically against the plugin's
			// declared minimum WordPress, and 6.0 is four releases before the
			// Abilities API existed.
			$ability = function_exists( 'wp_get_ability' ) ? wp_get_ability( (string) $name ) : null;

			if ( null === $ability ) {
				continue;
			}

			$meta        = $ability->get_meta();
			$annotations = isset( $meta['annotations'] ) ? $meta['annotations'] : array();

			// Refused even when named. An allowlist is somebody's intention;
			// an annotation is the ability's author telling you what it does.
			if ( ! empty( $annotations['destructive'] ) ) {
				continue;
			}

			// Anonymous permission is checked here rather than trusted later,
			// because the answer decides whether the model is even told the
			// ability exists. A WP_Error counts as a refusal.
			$permitted = $ability->check_permissions( array() );

			if ( true !== $permitted ) {
				continue;
			}

			$actions[ self::action_name( (string) $name ) ] = array(
				'description' => $ability->get_description(),
				'schema'      => $ability->get_input_schema(),
				'callback'    => self::caller( (string) $name ),
			);
		}

		return $actions;
	}

	/**
	 * An ability name, as a name a model can call.
	 *
	 * Tool names may not contain a slash, so the namespace separator becomes an
	 * underscore and the original is kept in the closure that calls it.
	 *
	 * @param string $name Ability name.
	 * @return string
	 */
	private static function action_name( $name ) {
		return substr( preg_replace( '/[^a-z0-9_]+/', '_', strtolower( $name ) ), 0, 64 );
	}

	/**
	 * A callback that runs one ability.
	 *
	 * @param string $name Ability name.
	 * @return callable
	 */
	private static function caller( $name ) {
		return function ( $input ) use ( $name ) {
			$ability = function_exists( 'wp_get_ability' ) ? wp_get_ability( $name ) : null;

			if ( null === $ability ) {
				return new \WP_Error( 'helpdeck_missing_ability', 'that is not available' );
			}

			return $ability->execute( $input );
		};
	}
}
