<?php
/**
 * Turning a rendered page into the text the index is built from.
 *
 * The chunker splits on headings, which is what makes a retrieved passage a
 * whole thought rather than half of two. So the headings have to survive the
 * trip out of HTML: `wp_strip_all_tags` on a page returns one undifferentiated
 * wall of prose, and every page becomes a single chunk that matches everything
 * and answers nothing.
 *
 * Deliberately not a general HTML-to-markdown converter. It keeps the six
 * things that carry structure in a support page, headings, paragraphs, list
 * items, line breaks, table rows and cells, and throws the rest away.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * HTML in, chunkable text out.
 */
class Html {

	/**
	 * Converts rendered post content to text with its headings intact.
	 *
	 * @param string $html Rendered HTML.
	 * @return string
	 */
	public static function to_text( $html ) {
		$text = (string) $html;

		// Scripts and styles first: their contents are not prose, and stripping
		// tags without removing them leaves CSS and JavaScript in the index,
		// where it matches nothing a customer would ever type.
		$text = preg_replace( '#<(script|style)\b[^>]*>.*?</\1>#is', ' ', $text );

		// Block comments, which every modern post is full of.
		$text = preg_replace( '/<!--.*?-->/s', ' ', $text );

		// Structure, before the tags go.
		$text = preg_replace_callback(
			'#<h([1-6])\b[^>]*>(.*?)</h\1>#is',
			function ( $matches ) {
				$level = (int) $matches[1];
				$inner = trim( self::plain( $matches[2] ) );

				if ( '' === $inner ) {
					return "\n\n";
				}

				return "\n\n" . str_repeat( '#', $level ) . ' ' . $inner . "\n\n";
			},
			$text
		);

		$text = preg_replace( '#<li\b[^>]*>#i', "\n- ", $text );
		$text = preg_replace( '#<br\s*/?>#i', "\n", $text );

		// A table row becomes a line and a cell becomes a gap, which is enough
		// for a specifications table to read as a list of facts rather than as
		// one run-on sentence.
		$text = preg_replace( '#</t[dh]>#i', ' ', $text );
		$text = preg_replace( '#</tr>#i', "\n", $text );

		// `li` is deliberately absent: its opening tag already started a line,
		// and closing it as a paragraph break would turn a five-item list into
		// five paragraphs, which the chunker then packs as five separate
		// thoughts.
		$text = preg_replace( '#</(p|div|section|article|ul|ol|table|blockquote|figure)>#i', "\n\n", $text );

		return self::plain( $text );
	}

	/**
	 * Strips what is left, decodes entities and tidies the whitespace.
	 *
	 * @param string $html Fragment.
	 * @return string
	 */
	private static function plain( $html ) {
		$text = preg_replace( '#<[^>]+>#', ' ', $html );

		// Entities become the characters they stand for. A page written with
		// `&amp;` should index as "&", and `&nbsp;` should be a space rather
		// than a character the tokeniser has to know about.
		$text = html_entity_decode( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = str_replace( "\xc2\xa0", ' ', $text );

		// Runs of spaces and tabs collapse; newlines are structure and survive.
		$text = preg_replace( '/[^\S\n]+/u', ' ', $text );
		$text = preg_replace( '/ *\n */u', "\n", $text );

		// Three or more blank lines is nothing; two is a paragraph break, which
		// is what the chunker packs on.
		$text = preg_replace( '/\n{3,}/u', "\n\n", $text );

		return trim( $text );
	}
}
