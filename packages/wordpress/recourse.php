<?php
/**
 * Plugin Name:       Recourse - AI Chatbot for Customer Support
 * Plugin URI:        https://github.com/ibrahimhajjaj/recourse
 * Description:       A support agent that answers from your own pages and products, with citations. Runs on your server; no content leaves it except the question you send to your own model provider.
 * Version:           0.2.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Ibrahim Hajjaj
 * Author URI:        https://github.com/ibrahimhajjaj
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       recourse
 * Domain Path:       /languages
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

define( 'RECOURSE_VERSION', '0.2.0' );
define( 'RECOURSE_FILE', __FILE__ );
define( 'RECOURSE_PATH', plugin_dir_path( __FILE__ ) );
define( 'RECOURSE_URL', plugin_dir_url( __FILE__ ) );

/**
 * Loads a class on demand.
 *
 * A hand-written autoloader rather than Composer's, because the plugin ships as
 * a zip to sites that have never run `composer install` and should not have to.
 * Composer is a development dependency here and nothing more.
 *
 * @param string $class_name Fully qualified class name.
 * @return void
 */
function autoload( $class_name ) {
	if ( 0 !== strpos( $class_name, __NAMESPACE__ . '\\' ) ) {
		return;
	}

	$relative = substr( $class_name, strlen( __NAMESPACE__ ) + 1 );
	$file     = RECOURSE_PATH . 'includes/class-' . strtolower( str_replace( '_', '-', $relative ) ) . '.php';

	if ( is_readable( $file ) ) {
		require_once $file;
	}
}

spl_autoload_register( __NAMESPACE__ . '\\autoload' );

Plugin::boot();
