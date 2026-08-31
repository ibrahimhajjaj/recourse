<?php
/**
 * The provider list is a convenience that becomes a trap the moment an entry
 * is wrong: somebody picks their provider, the boxes fill with a URL that does
 * not answer, and the plugin looks broken rather than misconfigured. So the
 * list is checked for the mistakes that are easy to make by hand.
 *
 * @package Recourse
 */

namespace Recourse\Tests;

use Recourse\Providers;
use PHPUnit\Framework\TestCase;

/**
 * The list of OpenAI-compatible endpoints offered in the settings.
 */
class ProvidersTest extends TestCase {

	/**
	 * Every entry carries the four fields the settings screen reads.
	 */
	public function test_every_entry_is_complete() {
		$all = Providers::all();

		$this->assertNotEmpty( $all );

		foreach ( $all as $key => $provider ) {
			foreach ( array( 'label', 'base_url', 'model', 'note' ) as $field ) {
				$this->assertArrayHasKey( $field, $provider, "$key is missing $field" );
				$this->assertNotSame( '', trim( (string) $provider[ $field ] ), "$key has an empty $field" );
			}
		}
	}

	/**
	 * Two providers on one host would make the picker open on the wrong one.
	 */
	public function test_no_two_providers_share_a_host() {
		$hosts = array();

		foreach ( Providers::all() as $key => $provider ) {
			$host = wp_parse_url( $provider['base_url'], PHP_URL_HOST );
			$this->assertNotEmpty( $host, "$key has a base URL with no host" );
			$this->assertNotContains( $host, $hosts, "$host is claimed by two providers" );
			$hosts[] = $host;
		}
	}

	/**
	 * A base URL that is not a URL is the failure that looks like a bug.
	 */
	public function test_every_base_url_parses_and_none_ends_in_a_slash() {
		foreach ( Providers::all() as $key => $provider ) {
			$url = $provider['base_url'];

			$this->assertNotFalse( wp_parse_url( $url ), "$key has an unparseable base URL" );
			$this->assertMatchesRegularExpression( '#^https?://#', $url, "$key is not http(s)" );
			// A trailing slash plus the client's own "/chat/completions" gives
			// a double slash, which some gateways answer with a 404.
			$this->assertStringEndsNotWith( '/', $url, "$key ends in a slash" );
		}
	}

	/**
	 * The picker has to open on whatever is already configured, including when
	 * somebody has typed the URL slightly differently from the listed one.
	 */
	public function test_match_finds_a_provider_by_host() {
		$this->assertSame( 'openai', Providers::match( 'https://api.openai.com/v1' ) );
		$this->assertSame( 'openai', Providers::match( 'https://api.openai.com/v1/' ) );
		$this->assertSame( 'deepseek', Providers::match( 'https://api.deepseek.com/v1' ) );
		$this->assertSame( 'ollama', Providers::match( 'http://localhost:11434/v1' ) );
	}

	/**
	 * Somebody running their own gateway gets "Other", not a wrong guess.
	 */
	public function test_match_says_nothing_for_an_endpoint_it_does_not_know() {
		$this->assertSame( '', Providers::match( 'https://models.acme.internal/v1' ) );
		$this->assertSame( '', Providers::match( '' ) );
		$this->assertSame( '', Providers::match( 'not a url' ) );
	}

	/**
	 * The JSON is embedded in an inline script, so it must not be able to
	 * close the tag it sits inside.
	 */
	public function test_the_json_cannot_break_out_of_a_script_tag() {
		$json = Providers::as_json();

		$this->assertIsArray( json_decode( $json, true ), 'as_json did not produce valid JSON' );
		$this->assertStringNotContainsString( '<', $json );
		$this->assertStringNotContainsString( '>', $json );
		$this->assertStringNotContainsString( '&', $json );
	}

	/**
	 * The script reads three fields off each entry and nothing else.
	 */
	public function test_the_json_carries_what_the_picker_uses() {
		$decoded = json_decode( Providers::as_json(), true );

		foreach ( $decoded as $key => $entry ) {
			$this->assertSame( array( 'base_url', 'model', 'note' ), array_keys( $entry ), "$key has unexpected fields" );
		}
	}
}
