<?php
/**
 * Plugin Name:       Helpdeck Support Agent
 * Plugin URI:        https://github.com/ibrahimhajjaj/helpdeck
 * Description:       A support agent that answers from your own pages and products, with citations. Runs on your server; no content leaves it except the question you send to your own model provider.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Ibrahim Hajjaj
 * Author URI:        https://github.com/ibrahimhajjaj
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       helpdeck
 * Domain Path:       /languages
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

define( 'HELPDECK_VERSION', '0.1.0' );
define( 'HELPDECK_FILE', __FILE__ );
define( 'HELPDECK_PATH', plugin_dir_path( __FILE__ ) );
define( 'HELPDECK_URL', plugin_dir_url( __FILE__ ) );

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
	$file     = HELPDECK_PATH . 'includes/class-' . strtolower( str_replace( '_', '-', $relative ) ) . '.php';

	if ( is_readable( $file ) ) {
		require_once $file;
	}
}

spl_autoload_register( __NAMESPACE__ . '\\autoload' );

Plugin::boot();
