<?php
/**
 * The actions a shop gets for free when WooCommerce is active.
 *
 * "Where is my order" is the single most common question a shop receives, and
 * it is answerable from the database rather than from a help page. That is the
 * line between a search box that talks and something worth installing.
 *
 * **An order number is not identity.** Order numbers are sequential, so anybody
 * who has one of their own can guess a hundred others. Every lookup here
 * demands the email the order was placed with and compares it against the order
 * itself, and a mismatch answers exactly as a missing order does, because two
 * different answers would turn this into a way of testing which numbers exist.
 *
 * Reads only. Nothing here cancels, refunds or changes anything, because a
 * model that misunderstands a sentence should not be able to refund an order.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * WooCommerce actions.
 */
class WooCommerce {

	/**
	 * Registers the actions when WooCommerce is present.
	 *
	 * @return void
	 */
	public static function register() {
		add_filter( 'recourse_actions', array( __CLASS__, 'add_actions' ) );
	}

	/**
	 * Whether this site has WooCommerce running.
	 *
	 * @return bool
	 */
	public static function active() {
		return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_order' );
	}

	/**
	 * Adds the order lookup and the stock check.
	 *
	 * @param array<string, array<string, mixed>> $actions Registered actions.
	 * @return array<string, array<string, mixed>>
	 */
	public static function add_actions( $actions ) {
		if ( ! self::active() ) {
			return $actions;
		}

		$actions['look_up_order'] = array(
			'description' => 'Look up the status of a customer order. Use whenever somebody asks where their order is, when it will arrive, or what was in it. Both the order number and the email address on the order are required; ask for whichever one you do not have.',
			'fields'      => array(
				'order_number' => array(
					'type'        => 'string',
					'description' => 'The order number, with or without a leading hash.',
					'required'    => true,
				),
				'email'        => array(
					'type'        => 'string',
					'description' => 'The email address the order was placed with.',
					'required'    => true,
				),
			),
			'callback'    => array( __CLASS__, 'look_up_order' ),
		);

		$actions['check_stock'] = array(
			'description' => 'Check whether a product is in stock and what it costs. Use when somebody asks about availability, sizes or price.',
			'fields'      => array(
				'product' => array(
					'type'        => 'string',
					'description' => 'The product name, as the customer said it.',
					'required'    => true,
				),
			),
			'callback'    => array( __CLASS__, 'check_stock' ),
		);

		return $actions;
	}

	/**
	 * Finds one order, for the person who placed it.
	 *
	 * @param array<string, mixed> $input Arguments from the model.
	 * @return array<string, mixed>
	 */
	public static function look_up_order( $input ) {
		$number = isset( $input['order_number'] ) ? trim( ltrim( (string) $input['order_number'], '#' ) ) : '';
		$email  = isset( $input['email'] ) ? sanitize_email( (string) $input['email'] ) : '';

		if ( '' === $number || '' === $email || ! is_email( $email ) ) {
			return array( 'error' => 'both an order number and the email on the order are needed' );
		}

		// The lookup is by id, and a shop with a plugin that renumbers orders
		// has a filter to translate. Guessing at the format here would find the
		// wrong order, which is worse than finding none.
		/**
		 * Filters the order id a customer-supplied order number refers to.
		 *
		 * @param int|string $id     The number as given.
		 * @param string     $number The number as given.
		 */
		$id    = apply_filters( 'recourse_order_id_from_number', $number, $number );
		$order = wc_get_order( $id );

		// One answer for "not yours" and "not there". Telling them apart is how
		// somebody maps which order numbers exist.
		$missing = array( 'error' => 'no order with that number and email address' );

		if ( ! $order ) {
			return $missing;
		}

		$billing = strtolower( (string) $order->get_billing_email() );

		if ( '' === $billing || ! hash_equals( $billing, strtolower( $email ) ) ) {
			return $missing;
		}

		$items = array();

		foreach ( $order->get_items() as $item ) {
			$items[] = array(
				'name'     => $item->get_name(),
				'quantity' => $item->get_quantity(),
			);
		}

		$created = $order->get_date_created();

		return array(
			'order_number' => $order->get_order_number(),
			'status'       => wc_get_order_status_name( $order->get_status() ),
			'placed'       => $created ? $created->date( 'Y-m-d' ) : '',
			'total'        => self::money( $order->get_total(), $order->get_currency() ),
			'items'        => $items,
			// The tracking number is what the customer actually wants, and
			// every shipping plugin stores it somewhere different.
			'tracking'     => apply_filters( 'recourse_order_tracking', '', $order ),
		);
	}

	/**
	 * A price, as a person would read it.
	 *
	 * `wc_price()` returns markup with the currency symbol as an entity, so a
	 * total handed straight to a model arrives as `&#36;29.00` and comes back
	 * out in the answer that way. Stripping the tags is not enough; the entity
	 * has to be decoded too.
	 *
	 * @param string|float $amount   Amount.
	 * @param string       $currency Currency code, when it is not the shop's.
	 * @return string
	 */
	private static function money( $amount, $currency = '' ) {
		$formatted = '' !== $currency
			? wc_price( $amount, array( 'currency' => $currency ) )
			: wc_price( $amount );

		return html_entity_decode( wp_strip_all_tags( $formatted ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	}

	/**
	 * Whether a product is in stock, and what it costs.
	 *
	 * @param array<string, mixed> $input Arguments from the model.
	 * @return array<string, mixed>
	 */
	public static function check_stock( $input ) {
		$term = isset( $input['product'] ) ? trim( (string) $input['product'] ) : '';

		if ( '' === $term ) {
			return array( 'error' => 'a product name is needed' );
		}

		$found = wc_get_products(
			array(
				's'      => $term,
				'status' => 'publish',
				'limit'  => 3,
			)
		);

		if ( empty( $found ) ) {
			return array( 'error' => 'no product by that name' );
		}

		$products = array();

		foreach ( $found as $product ) {
			$products[] = array(
				'name'         => $product->get_name(),
				'price'        => self::money( $product->get_price() ),
				'in_stock'     => $product->is_in_stock(),
				'stock_status' => $product->get_stock_status(),
				'url'          => $product->get_permalink(),
			);
		}

		return array( 'products' => $products );
	}
}
