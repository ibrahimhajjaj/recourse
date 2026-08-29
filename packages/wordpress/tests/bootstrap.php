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
 * @package Helpdeck
 */

define( 'HELPDECK_TESTING', true );

// Every class opens with the guard the plugin directory's scanner looks for,
// `defined( 'ABSPATH' ) || exit;`. Defining it here means the guard can be the
// standard one in every file rather than a variant with a test escape hatch in
// it, which is the sort of thing a reviewer reads twice.
// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- WordPress's own constant, stood up here because WordPress is not loaded.
define( 'ABSPATH', dirname( __DIR__ ) . '/' );

require_once __DIR__ . '/../vendor/autoload.php';

$helpdeck_testable = array(
	'tokenizer',
	'bm25',
	'chunker',
	'retriever',
	'index',
	'html',
	'prompt',
);

foreach ( $helpdeck_testable as $helpdeck_class ) {
	require_once __DIR__ . '/../includes/class-' . $helpdeck_class . '.php';
}

unset( $helpdeck_testable, $helpdeck_class );
