<?php
/**
 * Rebuilding the index, a batch at a time.
 *
 * Rendering a post runs every content filter the site has, page builders
 * included, and a shop with four hundred products cannot do that inside one
 * request without meeting the host's execution limit. So a rebuild walks the
 * site across cron runs, appending each batch to a working file, and only
 * replaces the live index when the last batch is in.
 *
 * That last part matters more than it looks: a rebuild that overwrites the
 * index as it goes leaves the assistant answering from half a site for however
 * long the rebuild takes, and a rebuild that fails halfway leaves it there for
 * good.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * The background rebuild.
 */
class Indexer {

	/**
	 * The cron hook one batch runs on.
	 */
	const HOOK = 'helpdeck_build_batch';

	/**
	 * The cron hook a content change schedules.
	 */
	const CHANGED_HOOK = 'helpdeck_content_changed';

	/**
	 * Option holding the state of a rebuild in progress.
	 *
	 * Spelled out at every call site as well. See the note in `Storage`: the
	 * directory's scanner reads the literal at the call, not the constant.
	 */
	const STATE_OPTION = 'helpdeck_build_state';

	/**
	 * Seconds to wait after a content change before rebuilding.
	 *
	 * A shop owner editing ten products in a minute must not trigger ten
	 * rebuilds, and the tenth edit is the one worth indexing anyway.
	 */
	const DEBOUNCE = 300;

	/**
	 * Hooks the rebuild up.
	 *
	 * @return void
	 */
	public static function register() {
		add_action( self::HOOK, array( __CLASS__, 'run_batch' ) );
		add_action( self::CHANGED_HOOK, array( __CLASS__, 'start' ) );

		add_action( 'save_post', array( __CLASS__, 'content_changed' ), 10, 2 );
		add_action( 'deleted_post', array( __CLASS__, 'content_changed' ) );
	}

	/**
	 * Schedules a rebuild after a content change, once.
	 *
	 * @param int           $post_id Post id.
	 * @param \WP_Post|null $post    Post, when the hook passes one.
	 * @return void
	 */
	public static function content_changed( $post_id, $post = null ) {
		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}

		if ( $post instanceof \WP_Post ) {
			$settings = Settings::all();

			// An edit to a post type nobody indexed is not a reason to spend
			// five minutes of somebody's shared hosting rebuilding.
			if ( ! in_array( $post->post_type, $settings['post_types'], true ) ) {
				return;
			}
		}

		if ( false === wp_next_scheduled( self::CHANGED_HOOK ) ) {
			wp_schedule_single_event( time() + self::DEBOUNCE, self::CHANGED_HOOK );
		}
	}

	/**
	 * Starts a rebuild from the first batch.
	 *
	 * @return void
	 */
	public static function start() {
		$settings = Settings::all();

		if ( empty( $settings['post_types'] ) ) {
			self::finish_with_nothing();
			return;
		}

		self::clear_working_file();

		update_option(
			'helpdeck_build_state',
			array(
				'page'       => 1,
				'documents'  => 0,
				'started_at' => time(),
				'post_types' => $settings['post_types'],
			),
			false
		);

		// Immediately rather than on the next cron tick, so the button on the
		// settings screen does something the moment it is pressed.
		self::run_batch();
	}

	/**
	 * Reads one batch, and schedules the next or finishes.
	 *
	 * @return void
	 */
	public static function run_batch() {
		$state = get_option( 'helpdeck_build_state' );

		if ( ! is_array( $state ) || ! isset( $state['page'] ) ) {
			return;
		}

		$batch = Content::documents( $state['post_types'], (int) $state['page'] );

		self::append( $batch['documents'] );

		$state['documents'] = (int) $state['documents'] + count( $batch['documents'] );

		if ( $batch['more'] ) {
			$state['page'] = (int) $state['page'] + 1;
			update_option( 'helpdeck_build_state', $state, false );

			// A minute apart, because the point of batching is to leave the
			// host some room, not to do the same work in a tighter loop.
			wp_schedule_single_event( time() + 60, self::HOOK );
			return;
		}

		self::finish();
	}

	/**
	 * Builds the index from the working file and puts it live.
	 *
	 * @return void
	 */
	private static function finish() {
		$documents = self::read_working_file();

		if ( empty( $documents ) ) {
			self::finish_with_nothing();
			return;
		}

		Storage::save( Index::build( $documents ) );

		self::clear_working_file();
		delete_option( 'helpdeck_build_state' );
	}

	/**
	 * Ends a rebuild that found nothing to index.
	 *
	 * The previous index is left alone. A site whose settings were saved with
	 * no post types ticked has said nothing about the index it already has.
	 *
	 * @return void
	 */
	private static function finish_with_nothing() {
		self::clear_working_file();
		delete_option( 'helpdeck_build_state' );
	}

	/**
	 * Whether a rebuild is running, for the settings screen.
	 *
	 * @return array{running: bool, page: int, documents: int}
	 */
	public static function progress() {
		$state = get_option( 'helpdeck_build_state' );

		if ( ! is_array( $state ) || ! isset( $state['page'] ) ) {
			return array(
				'running'   => false,
				'page'      => 0,
				'documents' => 0,
			);
		}

		return array(
			'running'   => true,
			'page'      => (int) $state['page'],
			'documents' => (int) $state['documents'],
		);
	}

	/**
	 * Appends a batch to the working file.
	 *
	 * One JSON object per line, because appending to a file costs nothing while
	 * rewriting a growing option costs more on every batch. On a large site the
	 * last batch would be rewriting several megabytes.
	 *
	 * @param array<int, array<string, mixed>> $documents Documents.
	 * @return void
	 */
	private static function append( $documents ) {
		$path = self::working_file();

		if ( null === $path || empty( $documents ) ) {
			return;
		}

		$lines = '';

		foreach ( $documents as $document ) {
			$encoded = wp_json_encode( $document );

			if ( false !== $encoded ) {
				$lines .= $encoded . "\n";
			}
		}

		Storage::append( $path, $lines );
	}

	/**
	 * Reads the working file back.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	private static function read_working_file() {
		$path = self::working_file();

		if ( null === $path ) {
			return array();
		}

		$documents = array();

		foreach ( Storage::read_lines( $path ) as $line ) {
			$document = json_decode( $line, true );

			if ( is_array( $document ) && isset( $document['id'] ) ) {
				$documents[] = $document;
			}
		}

		return $documents;
	}

	/**
	 * Where the working file lives.
	 *
	 * @return string|null
	 */
	private static function working_file() {
		$directory = Storage::directory();

		return null === $directory ? null : $directory . 'building.jsonl';
	}

	/**
	 * Removes the working file.
	 *
	 * @return void
	 */
	private static function clear_working_file() {
		$path = self::working_file();

		if ( null !== $path ) {
			Storage::delete_file( $path );
		}
	}
}
