<?php
/**
 * The version lives in four places and wp.org reads two of them.
 *
 * A release where readme.txt and the plugin header disagree is the classic
 * WordPress mistake: the directory serves whatever `Stable tag` names, so a
 * bumped header with a stale tag ships the old code to everybody and nothing
 * anywhere reports an error.
 *
 * @package Recourse
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Guards a release from the two mistakes that ship silently.
 */
final class ReleaseTest extends TestCase {

	/**
	 * The plugin directory, whatever the test is run from.
	 *
	 * @return string
	 */
	private function plugin_root(): string {
		return dirname( __DIR__ );
	}

	/**
	 * A bumped header with a stale tag ships the old code to everybody.
	 *
	 * @return void
	 */
	public function test_the_four_versions_agree(): void {
		$root = $this->plugin_root();

		$readme = file_get_contents( $root . '/readme.txt' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.
		$php    = file_get_contents( $root . '/recourse.php' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.
		$pkg    = json_decode( file_get_contents( $root . '/package.json' ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.

		preg_match( '/^Stable tag:\s*(\S+)/m', $readme, $tag );
		preg_match( '/^\s*\*\s*Version:\s*(\S+)/m', $php, $header );
		preg_match( "/define\(\s*'RECOURSE_VERSION',\s*'([^']+)'/", $php, $constant );

		$this->assertNotEmpty( $tag, 'readme.txt has no Stable tag' );
		$this->assertNotEmpty( $header, 'the plugin header has no Version' );
		$this->assertNotEmpty( $constant, 'RECOURSE_VERSION is not defined' );

		$this->assertSame( $header[1], $tag[1], 'readme.txt Stable tag and the plugin header disagree' );
		$this->assertSame( $header[1], $constant[1], 'the plugin header and RECOURSE_VERSION disagree' );
		$this->assertSame( $header[1], $pkg['version'], 'the plugin header and package.json disagree' );
	}

	/**
	 * The header block wp.org parses. A missing field is not a warning there,
	 * it is a rejected submission.
	 *
	 * @return void
	 */
	public function test_readme_carries_every_field_wporg_requires(): void {
		$readme = file_get_contents( $this->plugin_root() . '/readme.txt' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.

		foreach ( array(
			'Contributors',
			'Tags',
			'Requires at least',
			'Tested up to',
			'Requires PHP',
			'Stable tag',
			'License',
			'License URI',
		) as $field ) {
			$this->assertMatchesRegularExpression(
				'/^' . preg_quote( $field, '/' ) . ':\s*\S/m',
				$readme,
				"readme.txt is missing {$field}"
			);
		}
	}

	/**
	 * An option the plugin writes and uninstall does not delete is data left on
	 * somebody's site after they removed the plugin, which the directory treats
	 * as a defect and a site owner never sees.
	 *
	 * @return void
	 */
	public function test_uninstall_removes_every_option_the_plugin_writes(): void {
		$root = $this->plugin_root();

		$source = '';
		foreach ( glob( $root . '/includes/*.php' ) as $file ) {
			$source .= file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.
		}

		preg_match_all( "/const\s+OPTION[A-Z_]*\s*=\s*'([a-z_]+)'/", $source, $constants );
		preg_match_all( "/(?:update_option|add_option)\(\s*'([a-z_]+)'/", $source, $literals );
		$written = array_unique( array_merge( $constants[1], $literals[1] ) );

		$uninstall = file_get_contents( $root . '/uninstall.php' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.
		preg_match_all( "/delete_option\(\s*'([a-z_]+)'/", $uninstall, $removed );

		$this->assertNotEmpty( $written, 'no options were found, so this test is checking nothing' );
		$this->assertSame(
			array(),
			array_values( array_diff( $written, $removed[1] ) ),
			'options the plugin writes that uninstall leaves behind'
		);
	}

	/**
	 * Two limits that are silently truncated rather than reported: only the
	 * first five tags are used, and the short description is cut at 150.
	 *
	 * @return void
	 */
	public function test_readme_stays_inside_the_limits_wporg_truncates(): void {
		$readme = file_get_contents( $this->plugin_root() . '/readme.txt' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file on disk, in a test that does not load WordPress.

		preg_match( '/^Tags:\s*(.+)$/m', $readme, $tags );
		$count = count( array_filter( array_map( 'trim', explode( ',', $tags[1] ) ) ) );
		$this->assertLessThanOrEqual( 5, $count, 'wp.org uses only the first five tags' );

		preg_match( '/License URI:.*\n\n(.+)/', $readme, $short );
		$this->assertNotEmpty( $short, 'readme.txt has no short description' );
		$this->assertLessThanOrEqual(
			150,
			strlen( $short[1] ),
			'the short description is truncated at 150 characters'
		);
	}
}
