<?php
/**
 * What the shop owner can change, and where it is kept.
 *
 * One option holding one array, because a settings screen with twelve
 * `update_option` calls is twelve chances to leave the site half configured.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * Reads, writes and sanitises the settings.
 */
class Settings {

	/**
	 * The option name.
	 *
	 * Written out at call sites too, so the directory's scanner can see the
	 * prefix it is looking for.
	 */
	const OPTION = 'helpdeck_settings';

	/**
	 * Everything, with defaults filled in.
	 *
	 * @return array<string, mixed>
	 */
	public static function all() {
		$stored = get_option( 'helpdeck_settings', array() );

		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$settings = array(
			'enabled'    => isset( $stored['enabled'] ) ? (bool) $stored['enabled'] : false,
			'post_types' => isset( $stored['post_types'] ) && is_array( $stored['post_types'] )
				? $stored['post_types']
				: array( 'page', 'post' ),
			'persona'    => array(
				'name'         => self::text( $stored, 'persona', 'name', '' ),
				'business'     => self::text( $stored, 'persona', 'business', get_bloginfo( 'name' ) ),
				'greeting'     => self::text( $stored, 'persona', 'greeting', '' ),
				'fallback'     => self::text( $stored, 'persona', 'fallback', '' ),
				'instructions' => self::text( $stored, 'persona', 'instructions', '' ),
			),
			'model'      => array(
				'base_url' => self::text( $stored, 'model', 'base_url', '' ),
				'model'    => self::text( $stored, 'model', 'model', '' ),
				'api_key'  => self::api_key( $stored ),
			),
			'appearance' => array(
				'accent'   => self::text( $stored, 'appearance', 'accent', '#2563eb' ),
				'position' => 'left' === self::text( $stored, 'appearance', 'position', 'right' ) ? 'left' : 'right',
			),
		);

		return $settings;
	}

	/**
	 * The API key, from `wp-config.php` first.
	 *
	 * A constant is the right place for a credential: it is not in the
	 * database, so it does not travel in a backup, appear in an export, or
	 * belong to whoever has an administrator login this week.
	 *
	 * @param array<string, mixed> $stored Stored settings.
	 * @return string
	 */
	private static function api_key( $stored ) {
		if ( defined( 'HELPDECK_API_KEY' ) && '' !== HELPDECK_API_KEY ) {
			return (string) HELPDECK_API_KEY;
		}

		return self::text( $stored, 'model', 'api_key', '' );
	}

	/**
	 * Whether the key came from a constant, which the settings screen says out
	 * loud so nobody wonders why the field is empty.
	 *
	 * @return bool
	 */
	public static function key_is_a_constant() {
		return defined( 'HELPDECK_API_KEY' ) && '' !== HELPDECK_API_KEY;
	}

	/**
	 * One nested string setting.
	 *
	 * @param array<string, mixed> $stored   Stored settings.
	 * @param string               $group    Group key.
	 * @param string               $key      Setting key.
	 * @param string               $fallback Value when nothing is stored.
	 * @return string
	 */
	private static function text( $stored, $group, $key, $fallback ) {
		if ( isset( $stored[ $group ][ $key ] ) && is_string( $stored[ $group ][ $key ] ) ) {
			return $stored[ $group ][ $key ];
		}

		return $fallback;
	}

	/**
	 * Cleans what a form submitted.
	 *
	 * Registered as the sanitize callback, so nothing reaches the database
	 * without passing through here, including a value written by another
	 * plugin calling `update_option`.
	 *
	 * @param mixed $input Raw input.
	 * @return array<string, mixed>
	 */
	public static function sanitize( $input ) {
		if ( ! is_array( $input ) ) {
			return self::all();
		}

		$allowed_types = array_keys( Content::available_post_types() );
		$post_types    = array();

		if ( isset( $input['post_types'] ) && is_array( $input['post_types'] ) ) {
			foreach ( $input['post_types'] as $type ) {
				$type = sanitize_key( $type );

				// Only types that exist and are public. Otherwise the settings
				// screen becomes a way to index a private post type by posting
				// its name.
				if ( in_array( $type, $allowed_types, true ) ) {
					$post_types[] = $type;
				}
			}
		}

		$clean = array(
			'enabled'    => ! empty( $input['enabled'] ),
			'post_types' => $post_types,
			'persona'    => array(
				'name'         => self::clean_line( $input, 'persona', 'name' ),
				'business'     => self::clean_line( $input, 'persona', 'business' ),
				'greeting'     => self::clean_line( $input, 'persona', 'greeting' ),
				'fallback'     => self::clean_line( $input, 'persona', 'fallback' ),
				// The one multi-line field: extra rules for the model, where
				// newlines are how the rules are separated.
				'instructions' => isset( $input['persona']['instructions'] )
					? sanitize_textarea_field( $input['persona']['instructions'] )
					: '',
			),
			'model'      => array(
				'base_url' => isset( $input['model']['base_url'] )
					? esc_url_raw( trim( $input['model']['base_url'] ), array( 'http', 'https' ) )
					: '',
				'model'    => self::clean_line( $input, 'model', 'model' ),
			),
			'appearance' => array(
				'accent'   => isset( $input['appearance']['accent'] )
					? sanitize_hex_color( $input['appearance']['accent'] )
					: '#2563eb',
				'position' => isset( $input['appearance']['position'] ) && 'left' === $input['appearance']['position']
					? 'left'
					: 'right',
			),
		);

		if ( ! self::key_is_a_constant() ) {
			$clean['model']['api_key'] = isset( $input['model']['api_key'] )
				? trim( sanitize_text_field( $input['model']['api_key'] ) )
				: '';
		}

		if ( empty( $clean['appearance']['accent'] ) ) {
			$clean['appearance']['accent'] = '#2563eb';
		}

		return $clean;
	}

	/**
	 * One single-line field.
	 *
	 * @param array<string, mixed> $input Raw input.
	 * @param string               $group Group key.
	 * @param string               $key   Setting key.
	 * @return string
	 */
	private static function clean_line( $input, $group, $key ) {
		return isset( $input[ $group ][ $key ] ) ? sanitize_text_field( $input[ $group ][ $key ] ) : '';
	}

	/**
	 * Whether the widget should appear at all.
	 *
	 * Three things have to be true, and saying which one is missing is the
	 * whole job of the settings screen's status box.
	 *
	 * @return bool
	 */
	public static function ready() {
		$settings = self::all();

		return $settings['enabled']
			&& '' !== $settings['model']['base_url']
			&& '' !== $settings['model']['model']
			&& null !== Storage::load();
	}
}
