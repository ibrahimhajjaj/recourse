<?php
/**
 * What the shop owner can change, and where it is kept.
 *
 * One option holding one array, because a settings screen with twelve
 * `update_option` calls is twelve chances to leave the site half configured.
 *
 * @package Recourse
 */

namespace Recourse;

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
	const OPTION = 'recourse_settings';

	/**
	 * The tones the prompt knows how to turn into rules.
	 *
	 * A closed set so the settings screen and the sanitiser cannot drift apart,
	 * and so a hand-made POST cannot put arbitrary text where a tone belongs.
	 *
	 * @var array<int, string>
	 */
	const TONES = array( 'plain', 'warm', 'brisk', 'formal' );

	/**
	 * Everything, with defaults filled in.
	 *
	 * @return array<string, mixed>
	 */
	public static function all() {
		$stored = get_option( 'recourse_settings', array() );

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
				'tone'         => self::text( $stored, 'persona', 'tone', 'plain' ),
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
		if ( defined( 'RECOURSE_API_KEY' ) && '' !== RECOURSE_API_KEY ) {
			return (string) RECOURSE_API_KEY;
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
		return defined( 'RECOURSE_API_KEY' ) && '' !== RECOURSE_API_KEY;
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
	 * The chosen tone, or the default when it is not one we offer.
	 *
	 * A select element is only a suggestion. The request that arrives carries
	 * whatever the sender chose to put in it, so the closed set is checked here
	 * rather than trusted from the form.
	 *
	 * @param  array<string, mixed> $input Raw submitted settings.
	 * @return string
	 */
	private static function tone( $input ) {
		// The screen posts both: a select that is always one of the four, and a
		// textarea that is usually empty. Written wins when it has content,
		// which is what the checkbox beside it means.
		$written = isset( $input['persona']['tone_written'] )
			? trim( (string) $input['persona']['tone_written'] )
			: '';
		$value   = '' !== $written
			? $written
			: ( isset( $input['persona']['tone'] ) ? trim( (string) $input['persona']['tone'] ) : '' );

		if ( in_array( sanitize_key( $value ), self::TONES, true ) ) {
			return sanitize_key( $value );
		}

		// Not one of ours, so it is a tone somebody wrote. Kept as text rather
		// than forced into the closed set, because the whole point of a written
		// tone is that it is not one of the four. Only the bullet lines survive
		// the prompt builder, so what is stored here is documentation as much
		// as configuration.
		// The same test the prompt builder applies, so the two halves cannot
		// disagree about what a tone is. Looking for a bare dash anywhere
		// accepted prose with a hyphen in it, which stores fine and then
		// produces no rules, and threw away a tone written with asterisks.
		if ( '' !== $value && 1 === preg_match( '/^[-*]\s+\S/m', $value ) ) {
			return sanitize_textarea_field( $value );
		}

		return 'plain';
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
				// A closed set, checked here rather than trusted from the form.
				// A select element is only a suggestion; the request that
				// arrives is whatever the sender chose to put in it.
				'tone'         => self::tone( $input ),
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

		return $settings['enabled'] && self::has_a_model() && null !== Storage::load();
	}

	/**
	 * Whether anything can write an answer.
	 *
	 * Either an endpoint configured here, or WordPress's own AI client with a
	 * connector behind it, which needs nothing configured in this plugin at
	 * all.
	 *
	 * @return bool
	 */
	public static function has_a_model() {
		$settings = self::all();

		if ( '' !== $settings['model']['base_url'] && '' !== $settings['model']['model'] ) {
			return true;
		}

		return function_exists( 'wp_supports_ai' ) && wp_supports_ai();
	}
}
