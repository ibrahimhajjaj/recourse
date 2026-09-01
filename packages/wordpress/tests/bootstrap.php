<?php
/**
 * These tests deliberately run without WordPress.
 *
 * The retrieval engine touches no WordPress API at all, so loading a whole test
 * install to exercise it would buy nothing and cost every contributor a
 * database. The pieces that do need WordPress get their own suite alongside the
 * plugin itself.
 *
 * Only the WordPress-free classes are loaded, and they are listed one by one
 * rather than globbed. A glob picked up the classes that open with
 * `defined( 'ABSPATH' ) || exit;`, which does exactly what it says: the file
 * called `exit` during bootstrap and PHPUnit ended with no output, no tests and
 * an exit code of zero. A suite that silently runs nothing is worse than a
 * suite that fails.
 *
 * @package Recourse
 */

define( 'RECOURSE_TESTING', true );

// Every class opens with the guard the plugin directory's scanner looks for,
// `defined( 'ABSPATH' ) || exit;`. Defining it here means the guard can be the
// standard one in every file rather than a variant with a test escape hatch in
// it, which is the sort of thing a reviewer reads twice.
// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- WordPress's own constant, stood up here because WordPress is not loaded.
define( 'ABSPATH', dirname( __DIR__ ) . '/' );

require_once __DIR__ . '/../vendor/autoload.php';

/**
 * What `__()` does when no translation is loaded, which is what it does on most
 * installs. Enough to let the classes that only use it for message text be
 * tested without WordPress.
 *
 * @param string $text   Text.
 * @param string $domain Text domain, ignored.
 * @return string
 */
function __( $text, $domain = 'default' ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	unset( $domain );

	return $text;
}

/**
 * The sanitisers the settings screen runs a saved form through.
 *
 * Each is the documented behaviour rather than the implementation: a key is
 * lowercased and stripped to a safe alphabet, a text field loses its tags and
 * its line breaks, a textarea keeps the breaks.
 *
 * @param string $value Raw value.
 * @return string
 */
function sanitize_key( $value ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $value ) );
}

/**
 * A text field: tags gone, whitespace collapsed to single spaces.
 *
 * @param string $value Raw value.
 * @return string
 */
function sanitize_text_field( $value ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	return trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $value ) ) );
}

/**
 * A textarea: tags gone, line breaks kept.
 *
 * @param string $value Raw value.
 * @return string
 */
function sanitize_textarea_field( $value ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	return trim( wp_strip_all_tags( (string) $value ) );
}

/**
 * Markup removed, which is what both sanitisers lean on.
 *
 * @param string $value Raw value.
 * @return string
 */
function wp_strip_all_tags( $value ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	return strip_tags( (string) $value ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags
}

/**
 * A URL safe to store, as opposed to one safe to print.
 *
 * @param string $value Raw value.
 * @return string
 */
function esc_url_raw( $value ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	return filter_var( (string) $value, FILTER_SANITIZE_URL );
}

/**
 * The two post types every install has, which is all the settings sanitiser
 * needs to decide whether a submitted type is a real one.
 *
 * @param array  $args   Query, ignored.
 * @param string $output Shape, ignored.
 * @return array
 */
function get_post_types( $args = array(), $output = 'names' ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	unset( $args, $output );

	$types = array();

	foreach ( array(
		'post' => 'Posts',
		'page' => 'Pages',
	) as $recourse_name => $recourse_label ) {
		$type               = new \stdClass();
		$type->name         = $recourse_name;
		$type->labels       = new \stdClass();
		$type->labels->name = $recourse_label;

		$types[ $recourse_name ] = $type;
	}

	return $types;
}

/**
 * No database here, so every option is its default.
 *
 * @param string $name     Option name, ignored.
 * @param mixed  $fallback Whatever the caller will accept.
 * @return mixed
 */
function get_option( $name, $fallback = false ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	unset( $name );

	return $fallback;
}

$recourse_testable = array(
	'safety',
	'tokenizer',
	'relevance',
	'bm25',
	'chunker',
	'retriever',
	'index',
	'html',
	'prompt',
	'actions',
	// Only for the gate that decides what may be indexed, which returns before
	// it reaches a WordPress call. The stubs below cover what the rest of the
	// class would need if a test ever went past it.
	'content',
	'providers',
	// The tone the settings screen stores has to be one the prompt builder
	// will read back, and only a test that runs both halves can say so.
	'settings',
);

/**
 * Enough of the filter API for a gate that runs before anything else.
 *
 * @param string $hook  Hook name, ignored.
 * @param mixed  $value The value to pass through.
 * @return mixed
 */
function apply_filters( $hook, $value ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	unset( $hook );

	return $value;
}

/**
 * Stub of WordPress's URL parser, which is `parse_url` with the PHP 5.4 bug
 * worked around. The bug is irrelevant here; the signature is what matters.
 *
 * @param string $url       The URL.
 * @param int    $component Which piece to return, or -1 for all of it.
 * @return mixed
 */
function wp_parse_url( $url, $component = -1 ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	return parse_url( $url, $component ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url
}

/**
 * Stub. The plugin fires this when it refuses an indexed page; nothing in the
 * suite listens, and the point of the test is what survives the screen.
 *
 * @param string $hook Hook name.
 * @param mixed  ...$args Arguments.
 * @return void
 */
function do_action( $hook, ...$args ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	unset( $hook, $args );
}

/**
 * Stub of WordPress's JSON encoder.
 *
 * @param mixed $data    What to encode.
 * @param int   $options Encoding flags.
 * @return string|false
 */
function wp_json_encode( $data, $options = 0 ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedFunctionFound
	return json_encode( $data, $options ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
}

foreach ( $recourse_testable as $recourse_class ) {
	require_once __DIR__ . '/../includes/class-' . $recourse_class . '.php';
}

unset( $recourse_testable, $recourse_class );
