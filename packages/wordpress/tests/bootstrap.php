<?php
/**
 * These tests deliberately run without WordPress.
 *
 * The retrieval engine touches no WordPress API at all, so loading a whole
 * test install to exercise it would buy nothing and cost every contributor a
 * database. The pieces that do need WordPress get their own suite alongside
 * the plugin itself.
 *
 * @package Helpdeck
 */

define( 'HELPDECK_TESTING', true );

require_once __DIR__ . '/../vendor/autoload.php';

foreach ( glob( __DIR__ . '/../includes/class-*.php' ) as $class_file ) {
	require_once $class_file;
}
