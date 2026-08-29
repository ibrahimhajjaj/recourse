<?php
/**
 * Removes everything the plugin created.
 *
 * The order matters more than it looks. The index directory is named after the
 * `helpdeck_storage_key` option, so deleting that option first leaves the
 * directory with no way to find it: megabytes of the site's own content sitting
 * in uploads forever, under a random name nobody knows. Files first, then the
 * option that names them.
 *
 * @package Helpdeck
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

// The plugin's autoloader is not registered during uninstall, so the one class
// this needs is required by hand. `Storage::delete_all()` touches only
// `wp_upload_dir()`, `get_option()`, `WP_Filesystem` and `wp_delete_file()`, so
// nothing else has to come with it.
require_once __DIR__ . '/includes/class-storage.php';

/**
 * Removes the plugin's data from the current site.
 *
 * @return void
 */
function helpdeck_uninstall_site() {
	global $wpdb;

	\Helpdeck\Storage::delete_all();

	delete_option( 'helpdeck_settings' );
	delete_option( 'helpdeck_storage_key' );
	delete_option( 'helpdeck_build_state' );

	delete_transient( 'helpdeck_test_result' );

	// The rate limit counters are one transient per visitor and there is no API
	// for deleting a set of them by prefix. On a site with an external object
	// cache they never reach this table and expire on their own instead.
	$prefix  = $wpdb->esc_like( '_transient_helpdeck_' ) . '%';
	$timeout = $wpdb->esc_like( '_transient_timeout_helpdeck_' ) . '%';

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- there is no bulk transient API, and this runs once.
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$prefix,
			$timeout
		)
	);

	// `wp_unschedule_hook` rather than `wp_clear_scheduled_hook`, which matches
	// only events registered with no arguments. Today's are, and a future one
	// that takes a batch number would quietly stop being cleaned up.
	wp_unschedule_hook( 'helpdeck_build_batch' );
	wp_unschedule_hook( 'helpdeck_content_changed' );
}

if ( is_multisite() ) {
	// Walked in pages, because `get_sites()` returns 100 by default and a
	// network larger than that would keep its settings, its stored key and its
	// index on every site after the hundredth.
	$helpdeck_offset = 0;

	do {
		$helpdeck_sites = get_sites(
			array(
				'fields' => 'ids',
				'number' => 100,
				'offset' => $helpdeck_offset,
			)
		);

		foreach ( $helpdeck_sites as $helpdeck_site_id ) {
			switch_to_blog( $helpdeck_site_id );
			helpdeck_uninstall_site();
			restore_current_blog();
		}

		$helpdeck_offset += 100;
		$helpdeck_found   = count( $helpdeck_sites );
	} while ( 100 === $helpdeck_found );

	unset( $helpdeck_offset, $helpdeck_sites, $helpdeck_site_id, $helpdeck_found );
} else {
	helpdeck_uninstall_site();
}
