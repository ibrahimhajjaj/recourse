<?php
/**
 * Splitting a page into the passages retrieval works on.
 *
 * Headings first, then packing up to a size budget. A heading is where the
 * author already decided one idea stops and the next begins, so respecting
 * them beats a fixed window: a retrieved passage arrives as a whole thought
 * rather than half of two.
 *
 * The same splitting as `chunk/markdown.ts`, and the parity tests hold it
 * there. A shop that later moves to the Node core should not have its answers
 * change underneath it.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * Turns documents into chunks.
 */
class Chunker {

	/**
	 * Upper bound on a chunk, in characters. Roughly 300 tokens.
	 */
	const MAX_CHARS = 1200;

	/**
	 * Below this a chunk is folded into its neighbour instead of standing
	 * alone, because a stray fragment retrieves badly.
	 */
	const MIN_CHARS = 120;

	/**
	 * Characters of the previous chunk repeated at the start of the next, so a
	 * sentence spanning the seam is still findable.
	 */
	const OVERLAP = 150;

	/**
	 * Splits one document.
	 *
	 * @param array<string, mixed> $doc Keys: id, title, text, url, meta.
	 * @return array<int, array<string, mixed>>
	 */
	public static function split( $doc ) {
		$text     = isset( $doc['text'] ) ? (string) $doc['text'] : '';
		$sections = self::to_sections( self::strip_navigation( $text ) );

		$chunks  = array();
		$ordinal = 0;

		foreach ( $sections as $section ) {
			foreach ( self::pack_section( $section['body'] ) as $body ) {
				$body = trim( $body );
				if ( '' === $body ) {
					continue;
				}

				$last = count( $chunks ) - 1;
				if (
					self::length( $body ) < self::MIN_CHARS
					&& $last >= 0
					&& self::section_of( $chunks[ $last ] ) === $section['heading']
				) {
					$chunks[ $last ]['text'] .= "\n\n" . $body;
					continue;
				}

				$chunk = array(
					'id'    => $doc['id'] . '#' . $ordinal,
					'docId' => $doc['id'],
					'title' => isset( $doc['title'] ) ? $doc['title'] : '',
					'text'  => $body,
				);
				++$ordinal;

				if ( '' !== $section['heading'] ) {
					$chunk['section'] = $section['heading'];
				}
				if ( isset( $doc['url'] ) && '' !== $doc['url'] ) {
					$chunk['url'] = $doc['url'];
				}
				if ( isset( $doc['meta'] ) && ! empty( $doc['meta'] ) ) {
					$chunk['meta'] = $doc['meta'];
				}

				$chunks[] = $chunk;
			}
		}

		return $chunks;
	}

	/**
	 * A chunk's heading, or the empty string when it has none.
	 *
	 * @param array<string, mixed> $chunk Chunk.
	 * @return string
	 */
	private static function section_of( $chunk ) {
		return isset( $chunk['section'] ) ? $chunk['section'] : '';
	}

	/**
	 * Drops navigation blocks.
	 *
	 * Menus, breadcrumbs and footers repeat on every page. Left in, they become
	 * the most common text in the corpus and poison both the keyword statistics
	 * and the model's context.
	 *
	 * @param string $text Document text.
	 * @return string
	 */
	private static function strip_navigation( $text ) {
		$lines = explode( "\n", $text );
		$kept  = array();
		$run   = 0;

		foreach ( $lines as $line ) {
			// A line that is nothing but a link, which is what scraped
			// navigation looks like.
			if ( 1 === preg_match( '/^\s*[-*]?\s*\[[^\]]*\]\([^)]*\)\s*$/u', $line ) ) {
				++$run;
				// One or two links in a row is prose. Four is a menu.
				if ( $run >= 4 ) {
					continue;
				}
			} else {
				$run = 0;
			}

			$kept[] = $line;
		}

		return implode( "\n", $kept );
	}

	/**
	 * Splits on headings, keeping the full heading trail.
	 *
	 * @param string $text Document text.
	 * @return array<int, array{heading: string, body: string}>
	 */
	private static function to_sections( $text ) {
		$lines    = explode( "\n", $text );
		$sections = array();

		/**
		 * Heading text by depth, so a nested heading can render its trail.
		 *
		 * @var array<int, string>
		 */
		$trail    = array();
		$heading  = '';
		$body     = array();
		$in_fence = false;

		foreach ( $lines as $line ) {
			if ( 1 === preg_match( '/^\s*(```|~~~)/u', $line ) ) {
				$in_fence = ! $in_fence;
			}

			$matches = array();
			$is_head = ! $in_fence && 1 === preg_match( '/^(#{1,6})\s+(.*)$/u', $line, $matches );

			if ( $is_head ) {
				$joined = trim( implode( "\n", $body ) );
				if ( '' !== $joined ) {
					$sections[] = array(
						'heading' => $heading,
						'body'    => $joined,
					);
				}
				$body = array();

				$depth = strlen( $matches[1] );

				// Everything deeper than this heading is no longer in scope.
				$trail = array_slice( $trail, 0, $depth - 1 );
				for ( $i = count( $trail ); $i < $depth - 1; $i++ ) {
					$trail[ $i ] = '';
				}
				$trail[ $depth - 1 ] = self::clean_heading( $matches[2] );

				$heading = implode( ' > ', array_filter( $trail, 'strlen' ) );
				continue;
			}

			$body[] = $line;
		}

		$joined = trim( implode( "\n", $body ) );
		if ( '' !== $joined ) {
			$sections[] = array(
				'heading' => $heading,
				'body'    => $joined,
			);
		}

		return $sections;
	}

	/**
	 * Strips markup out of a heading.
	 *
	 * Documentation generators hang an anchor link inside the heading itself,
	 * so a scraped `## Refunds` arrives with a URL in it. Left alone that URL
	 * becomes part of the citation shown to the customer and part of the
	 * keyword index, where it matches nothing anyone would type.
	 *
	 * @param string $raw Raw heading text.
	 * @return string
	 */
	private static function clean_heading( $raw ) {
		// Keep a link's text, drop its target.
		$out = preg_replace( '/!?\[([^\]]*)\]\([^)]*\)/u', '$1', $raw );
		$out = preg_replace( '/[*_`#]/u', '', $out );
		// Zero-width and non-breaking characters are what anchor links are
		// made of.
		$out = preg_replace( '/[\x{200b}-\x{200d}\x{feff}\x{00a0}]/u', ' ', $out );
		$out = preg_replace( '/\s+/u', ' ', $out );

		return trim( $out );
	}

	/**
	 * Fills chunks paragraph by paragraph, never cutting mid-paragraph.
	 *
	 * @param string $body Section body.
	 * @return array<int, string>
	 */
	private static function pack_section( $body ) {
		if ( self::length( $body ) <= self::MAX_CHARS ) {
			return array( $body );
		}

		$paragraphs = preg_split( '/\n{2,}/u', $body );
		if ( false === $paragraphs ) {
			return array( $body );
		}

		$out     = array();
		$current = '';

		foreach ( $paragraphs as $paragraph ) {
			// A single paragraph over budget, a long table, or a code block,
			// is split hard, because there is no better seam inside it.
			if ( self::length( $paragraph ) > self::MAX_CHARS ) {
				self::push( $out, $current );

				$length = self::length( $paragraph );
				for ( $i = 0; $i < $length; $i += self::MAX_CHARS ) {
					$out[] = trim( self::slice( $paragraph, $i, self::MAX_CHARS ) );
				}

				$current = '';
				continue;
			}

			if ( self::length( $current ) + self::length( $paragraph ) > self::MAX_CHARS ) {
				self::push( $out, $current );
			}

			$current .= $paragraph . "\n\n";
		}

		self::push( $out, $current );

		$kept = array();
		foreach ( $out as $chunk ) {
			if ( '' !== trim( $chunk ) ) {
				$kept[] = $chunk;
			}
		}

		return $kept;
	}

	/**
	 * Closes the current chunk and carries its tail forward.
	 *
	 * @param array<int, string> $out     Chunks so far, by reference.
	 * @param string             $current The chunk being filled, by reference.
	 * @return void
	 */
	private static function push( &$out, &$current ) {
		if ( '' === trim( $current ) ) {
			return;
		}

		$out[]   = trim( $current );
		$current = self::OVERLAP > 0 ? self::slice( $current, -self::OVERLAP ) . "\n\n" : '';
	}

	/**
	 * Length in code points.
	 *
	 * @param string $text Text.
	 * @return int
	 */
	private static function length( $text ) {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $text, 'UTF-8' ) : strlen( $text );
	}

	/**
	 * Substring by code point.
	 *
	 * @param string   $text   Text.
	 * @param int      $start  Start offset.
	 * @param int|null $length Length.
	 * @return string
	 */
	private static function slice( $text, $start, $length = null ) {
		if ( function_exists( 'mb_substr' ) ) {
			return null === $length ? mb_substr( $text, $start, null, 'UTF-8' ) : mb_substr( $text, $start, $length, 'UTF-8' );
		}

		return null === $length ? substr( $text, $start ) : substr( $text, $start, $length );
	}
}
