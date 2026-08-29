<?php
/**
 * What runs on every request, and nothing more.
 *
 * The front end of a shop is the most performance-sensitive code a plugin can
 * touch, so the rule here is that a page with no widget on it does no work at
 * all: no index read, no option read beyond the one, no script enqueued.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * Wiring.
 */
class Plugin {

	/**
	 * Hooks everything up.
	 *
	 * @return void
	 */
	public static function boot() {
		add_action( 'rest_api_init', array( Rest::class, 'register' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_widget' ) );

		Indexer::register();

		if ( is_admin() ) {
			Admin::register();
		}

		register_deactivation_hook( HELPDECK_FILE, array( __CLASS__, 'deactivate' ) );
	}

	/**
	 * Puts the widget on the page.
	 *
	 * @return void
	 */
	public static function enqueue_widget() {
		if ( is_admin() || ! Settings::ready() ) {
			return;
		}

		/**
		 * Filters whether the widget appears on this request.
		 *
		 * For hiding it on checkout, on a landing page, or from logged-in
		 * staff who do not need to be sold their own help pages.
		 *
		 * @param bool $show Whether to show it.
		 */
		if ( ! apply_filters( 'helpdeck_show_widget', true ) ) {
			return;
		}

		$settings = Settings::all();

		wp_enqueue_script(
			'helpdeck-widget',
			HELPDECK_URL . 'assets/helpdeck.min.js',
			array(),
			HELPDECK_VERSION,
			true
		);

		// Configuration travels as data attributes on the script tag, which is
		// what the widget reads. `wp_localize_script` would work too and would
		// put a global on the page for no reason.
		$config = array(
			'endpoint' => esc_url_raw( rest_url( Rest::NAMESPACE_V1 . '/chat' ) ),
			'name'     => $settings['persona']['name'],
			'greeting' => $settings['persona']['greeting'],
			'accent'   => $settings['appearance']['accent'],
			'position' => $settings['appearance']['position'],
		);

		wp_localize_script( 'helpdeck-widget', 'helpdeckConfig', $config );
	}

	/**
	 * Clears the scheduled work when the plugin is switched off.
	 *
	 * The index and the settings stay: deactivating a plugin is not the same as
	 * uninstalling it, and a shop owner who deactivates to test a conflict
	 * should not have to rebuild afterwards.
	 *
	 * @return void
	 */
	public static function deactivate() {
		wp_clear_scheduled_hook( Indexer::HOOK );
		wp_clear_scheduled_hook( Indexer::CHANGED_HOOK );
	}
}
