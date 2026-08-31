<?php
/**
 * Removes everything the plugin created.
 *
 * The order matters more than it looks. The index directory is named after the
 * `recourse_storage_key` option, so deleting that option first leaves the
 * directory with no way to find it: megabytes of the site's own content sitting
 * in uploads forever, under a random name nobody knows. Files first, then the
 * option that names them.
 *
 * @package Recourse
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
function recourse_uninstall_site() {
	global $wpdb;

	\Recourse\Storage::delete_all();

	delete_option( 'recourse_settings' );
	delete_option( 'recourse_storage_key' );
	delete_option( 'recourse_build_state' );

	// Every transient this plugin sets is keyed per visitor or per admin user:
	// the rate limit counters, and one connection-test result per user id. There
	// is no API for deleting a set of them by prefix, so they go in one query.
	// A site with an external object cache keeps none of them in this table, and
	// both kinds expire on their own instead.
	$prefix  = $wpdb->esc_like( '_transient_recourse_' ) . '%';
	$timeout = $wpdb->esc_like( '_transient_timeout_recourse_' ) . '%';

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
	wp_unschedule_hook( 'recourse_build_batch' );
	wp_unschedule_hook( 'recourse_content_changed' );
}

if ( is_multisite() ) {
	// Walked in pages, because `get_sites()` returns 100 by default and a
	// network larger than that would keep its settings, its stored key and its
	// index on every site after the hundredth.
	$recourse_offset = 0;

	do {
		$recourse_sites = get_sites(
			array(
				'fields' => 'ids',
				'number' => 100,
				'offset' => $recourse_offset,
			)
		);

		foreach ( $recourse_sites as $recourse_site_id ) {
			switch_to_blog( $recourse_site_id );
			recourse_uninstall_site();
			restore_current_blog();
		}

		$recourse_offset += 100;
		$recourse_found   = count( $recourse_sites );
	} while ( 100 === $recourse_found );

	unset( $recourse_offset, $recourse_sites, $recourse_site_id, $recourse_found );
} else {
	recourse_uninstall_site();
}
