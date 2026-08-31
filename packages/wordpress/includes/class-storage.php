<?php
/**
 * Where the index lives on disk.
 *
 * In `uploads`, because that is the one directory a WordPress install is
 * guaranteed to be able to write to, and shared hosting will not give you
 * another.
 *
 * That directory is also served over HTTP, so the folder name carries a random
 * suffix generated at install time. An `.htaccess` and an `index.php` go in
 * beside it, which handle Apache and directory listings; the random name is
 * what handles nginx, where `.htaccess` does nothing at all.
 *
 * None of this is secret. The index holds published content, which is public by
 * definition. It is not something to hand out as one downloadable file either.
 *
 * Everything goes through `WP_Filesystem` where the host allows it. Where it
 * does not, an install configured for FTP, which cannot be initialised without
 * credentials nobody can supply during a customer's chat request, it falls
 * back to reading and writing the file directly. Failing the chat instead would
 * be the wrong trade.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes the index file.
 */
class Storage {

	/**
	 * Option holding the random directory suffix.
	 *
	 * Written out in full at every call site rather than used through this
	 * constant. The directory's scanner reads the literal string at the call to
	 * `get_option`, and a name assembled from a constant is invisible to it,
	 * which turns a correctly prefixed option into a review finding.
	 */
	const SECRET_OPTION = 'recourse_storage_key';

	/**
	 * The parsed index, kept for the life of the request.
	 *
	 * Parsing a megabyte of JSON is the most expensive thing a chat request
	 * does, and a turn reads the index once for retrieval and again for the
	 * citations.
	 *
	 * @var array<string, mixed>|null
	 */
	private static $cached = null;

	/**
	 * The filesystem, once it has been asked for.
	 *
	 * @var \WP_Filesystem_Base|null
	 */
	private static $filesystem = null;

	/**
	 * WordPress's filesystem abstraction, when this host can give us one.
	 *
	 * @return \WP_Filesystem_Base|null
	 */
	private static function filesystem() {
		if ( null !== self::$filesystem ) {
			return self::$filesystem;
		}

		global $wp_filesystem;

		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}

		// No credentials are passed, so this succeeds on the direct method and
		// fails on FTP and SSH, which is the correct outcome: those need a form
		// somebody has to fill in, and there is nobody to fill it in during a
		// cron run or a chat request.
		if ( WP_Filesystem() && $wp_filesystem instanceof \WP_Filesystem_Base ) {
			self::$filesystem = $wp_filesystem;
		}

		return self::$filesystem;
	}

	/**
	 * The directory the index lives in, created if it is not there.
	 *
	 * @return string|null Absolute path with a trailing slash, or null when
	 *                     uploads is not writable.
	 */
	public static function directory() {
		$uploads = wp_upload_dir();

		if ( ! empty( $uploads['error'] ) ) {
			return null;
		}

		$path = trailingslashit( $uploads['basedir'] ) . 'recourse-' . self::secret() . '/';

		if ( ! is_dir( $path ) ) {
			wp_mkdir_p( $path );
		}

		self::protect( $path );

		return $path;
	}

	/**
	 * The random suffix, made once and kept.
	 *
	 * @return string
	 */
	private static function secret() {
		$secret = get_option( 'recourse_storage_key' );

		if ( ! is_string( $secret ) || 8 > strlen( $secret ) ) {
			$secret = wp_generate_password( 16, false, false );
			update_option( 'recourse_storage_key', $secret, false );
		}

		return $secret;
	}

	/**
	 * Drops the files that stop the directory being browsed.
	 *
	 * @param string $path Directory.
	 * @return void
	 */
	private static function protect( $path ) {
		if ( ! file_exists( $path . 'index.php' ) ) {
			self::write( $path . 'index.php', "<?php\n// Silence is golden.\n" );
		}

		if ( ! file_exists( $path . '.htaccess' ) ) {
			self::write( $path . '.htaccess', "Options -Indexes\ndeny from all\n" );
		}
	}

	/**
	 * The index file's path.
	 *
	 * @return string|null
	 */
	public static function path() {
		$directory = self::directory();

		return null === $directory ? null : $directory . 'knowledge.json';
	}

	/**
	 * Writes an index.
	 *
	 * Written under a temporary name and moved into place, because a chat
	 * request arriving mid-write would otherwise read half a file and answer
	 * from nothing.
	 *
	 * @param array<string, mixed> $index Index.
	 * @return bool
	 */
	public static function save( $index ) {
		$path = self::path();

		if ( null === $path ) {
			return false;
		}

		$temporary = $path . '.' . wp_generate_password( 6, false, false ) . '.tmp';

		if ( ! self::write( $temporary, Index::encode( $index ) ) ) {
			return false;
		}

		if ( ! self::move( $temporary, $path ) ) {
			self::delete_file( $temporary );
			return false;
		}

		self::$cached = null;

		return true;
	}

	/**
	 * Reads the index.
	 *
	 * @return array<string, mixed>|null
	 */
	public static function load() {
		if ( null !== self::$cached ) {
			return self::$cached;
		}

		$path = self::path();

		if ( null === $path || ! file_exists( $path ) ) {
			return null;
		}

		$json = self::read( $path );

		if ( null === $json ) {
			return null;
		}

		self::$cached = Index::parse( $json );

		return self::$cached;
	}

	/**
	 * Adds to the end of a file.
	 *
	 * `WP_Filesystem` has no append, so this reads and rewrites. The caller is
	 * the batched rebuild, which appends once per batch rather than once per
	 * document, so the cost is bounded by the number of batches.
	 *
	 * @param string $path    File.
	 * @param string $content What to add.
	 * @return bool
	 */
	public static function append( $path, $content ) {
		$existing = file_exists( $path ) ? self::read( $path ) : '';

		return self::write( $path, ( null === $existing ? '' : $existing ) . $content );
	}

	/**
	 * Reads a file back as lines, skipping the empty ones.
	 *
	 * @param string $path File.
	 * @return array<int, string>
	 */
	public static function read_lines( $path ) {
		if ( ! file_exists( $path ) ) {
			return array();
		}

		$content = self::read( $path );

		if ( null === $content || '' === $content ) {
			return array();
		}

		return array_values( array_filter( explode( "\n", $content ), 'strlen' ) );
	}

	/**
	 * Removes one file.
	 *
	 * @param string $path File.
	 * @return void
	 */
	public static function delete_file( $path ) {
		if ( ! file_exists( $path ) ) {
			return;
		}

		$filesystem = self::filesystem();

		if ( null !== $filesystem ) {
			$filesystem->delete( $path );
			return;
		}

		wp_delete_file( $path );
	}

	/**
	 * Writes a whole file.
	 *
	 * @param string $path    File.
	 * @param string $content Contents.
	 * @return bool
	 */
	private static function write( $path, $content ) {
		$filesystem = self::filesystem();

		if ( null !== $filesystem ) {
			return (bool) $filesystem->put_contents( $path, $content, FS_CHMOD_FILE );
		}

		// Reached only where WP_Filesystem could not be initialised, which
		// means an FTP or SSH install being asked to write during cron.
		return false !== file_put_contents( $path, $content ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- no filesystem abstraction is available in this context.
	}

	/**
	 * Reads a whole file.
	 *
	 * @param string $path File.
	 * @return string|null
	 */
	private static function read( $path ) {
		$filesystem = self::filesystem();

		if ( null !== $filesystem ) {
			$content = $filesystem->get_contents( $path );

			return false === $content ? null : $content;
		}

		$content = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a local file this plugin wrote, and no filesystem abstraction is available.

		return false === $content ? null : $content;
	}

	/**
	 * Moves a file over whatever is already there.
	 *
	 * @param string $from Source.
	 * @param string $to   Destination.
	 * @return bool
	 */
	private static function move( $from, $to ) {
		$filesystem = self::filesystem();

		if ( null !== $filesystem ) {
			return (bool) $filesystem->move( $from, $to, true );
		}

		return rename( $from, $to ); // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename -- no filesystem abstraction is available in this context.
	}

	/**
	 * What the settings screen shows about the current index.
	 *
	 * @return array{exists: bool, documents: int, chunks: int, built: string, bytes: int}
	 */
	public static function status() {
		$path  = self::path();
		$index = self::load();

		if ( null === $index || null === $path ) {
			return array(
				'exists'    => false,
				'documents' => 0,
				'chunks'    => 0,
				'built'     => '',
				'bytes'     => 0,
			);
		}

		return array(
			'exists'    => true,
			'documents' => isset( $index['stats']['documents'] ) ? (int) $index['stats']['documents'] : 0,
			'chunks'    => isset( $index['stats']['chunks'] ) ? (int) $index['stats']['chunks'] : 0,
			'built'     => isset( $index['createdAt'] ) ? (string) $index['createdAt'] : '',
			'bytes'     => file_exists( $path ) ? (int) filesize( $path ) : 0,
		);
	}

	/**
	 * Removes everything this wrote. Called on uninstall.
	 *
	 * @return void
	 */
	public static function delete_all() {
		$uploads = wp_upload_dir();

		if ( ! empty( $uploads['error'] ) ) {
			return;
		}

		$secret = get_option( 'recourse_storage_key' );

		if ( ! is_string( $secret ) || '' === $secret ) {
			return;
		}

		$path = trailingslashit( $uploads['basedir'] ) . 'recourse-' . $secret . '/';

		if ( ! is_dir( $path ) ) {
			return;
		}

		$filesystem = self::filesystem();

		if ( null !== $filesystem ) {
			$filesystem->delete( $path, true );
			return;
		}

		foreach ( (array) glob( $path . '*' ) as $file ) {
			if ( is_file( $file ) ) {
				wp_delete_file( $file );
			}
		}

		// The directory itself is left in place. Removing it needs a filesystem
		// this host would not give us, and an empty folder in uploads is a
		// smaller problem than an uninstall that dies half way.
	}
}
