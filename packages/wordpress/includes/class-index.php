<?php
/**
 * Building and reading the knowledge index.
 *
 * The file format is the one the Node core writes and reads, version and all.
 * That is deliberate: a shop that outgrows the plugin and moves to the
 * self-hosted core should be able to take its index with it, and a developer
 * who builds an index with `helpdeck ingest` should be able to drop it in here.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * Turns documents into a searchable index, and back again.
 */
class Index {

	/**
	 * The only format version this understands.
	 */
	const VERSION = 1;

	/**
	 * Builds an index from documents.
	 *
	 * Keyword only. Vectors need an embedding credential and a model call per
	 * chunk, which is the thing this plugin exists to not require; an index
	 * built here and served here is consistent either way.
	 *
	 * @param array<int, array<string, mixed>> $documents Each: id, title, text, url, meta.
	 * @return array<string, mixed>
	 */
	public static function build( $documents ) {
		// Two sources can legitimately return the same page. Last one wins,
		// matching the core.
		$unique = array();
		foreach ( $documents as $document ) {
			if ( ! isset( $document['id'] ) || '' === $document['id'] ) {
				continue;
			}
			$unique[ (string) $document['id'] ] = $document;
		}

		$chunks     = array();
		$characters = 0;

		foreach ( $unique as $document ) {
			$characters += strlen( isset( $document['text'] ) ? $document['text'] : '' );
			foreach ( Chunker::split( $document ) as $chunk ) {
				$chunks[] = $chunk;
			}
		}

		$searchable = array();
		foreach ( $chunks as $chunk ) {
			// The heading trail goes into the indexed text, so a query matching
			// only the heading ("refund policy") still finds the paragraph
			// underneath it.
			$parts = array();
			foreach ( array( 'title', 'section', 'text' ) as $field ) {
				if ( isset( $chunk[ $field ] ) && '' !== $chunk[ $field ] ) {
					$parts[] = $chunk[ $field ];
				}
			}
			$searchable[] = implode( "\n", $parts );
		}

		return array(
			'version'   => self::VERSION,
			// The same shape JavaScript's toISOString produces, so a file
			// written here and one written by `helpdeck ingest` are the same
			// kind of thing to anything reading them.
			'createdAt' => gmdate( 'Y-m-d\TH:i:s' ) . '.000Z',
			'chunks'    => $chunks,
			'keyword'   => Bm25::build( $searchable ),
			'stats'     => array(
				'documents'  => count( $unique ),
				'chunks'     => count( $chunks ),
				'characters' => $characters,
			),
		);
	}

	/**
	 * Reads an index, refusing anything it cannot serve correctly.
	 *
	 * A malformed index that half works produces bad answers rather than an
	 * error, which is the worst outcome available.
	 *
	 * @param string $json Index JSON.
	 * @return array<string, mixed>|null Null when it cannot be used.
	 */
	public static function parse( $json ) {
		$index = json_decode( $json, true );

		if ( ! is_array( $index ) ) {
			return null;
		}
		if ( ! isset( $index['version'] ) || self::VERSION !== (int) $index['version'] ) {
			return null;
		}
		if ( ! isset( $index['chunks'] ) || ! is_array( $index['chunks'] ) ) {
			return null;
		}
		if ( ! isset( $index['keyword']['postings'] ) || ! isset( $index['keyword']['lengths'] ) ) {
			return null;
		}

		return $index;
	}

	/**
	 * Serialises an index for storage.
	 *
	 * The postings table is cast to an object first. PHP encodes an array as a
	 * JSON array whenever its keys happen to be 0, 1, 2 and so on, which an
	 * empty index always is, and a corpus of nothing but numbers could be,
	 * and the format says that member is an object.
	 *
	 * @param array<string, mixed> $index Index.
	 * @return string
	 */
	public static function encode( $index ) {
		if ( isset( $index['keyword']['postings'] ) ) {
			$index['keyword']['postings'] = (object) $index['keyword']['postings'];
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- the fallback is for the test suite, which runs without WordPress loaded.
		$json = function_exists( 'wp_json_encode' ) ? wp_json_encode( $index ) : json_encode( $index );

		return false === $json ? '' : $json;
	}
}
