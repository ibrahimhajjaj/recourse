<?php
/**
 * What a rendered page has to survive on its way into the index.
 *
 * @package Recourse
 */

namespace Recourse\Tests;

use Recourse\Chunker;
use Recourse\Html;
use PHPUnit\Framework\TestCase;

/**
 * HTML to indexable text.
 */
class HtmlTest extends TestCase {

	/**
	 * Headings are the whole reason this class exists.
	 *
	 * @return void
	 */
	public function test_headings_become_markdown_headings() {
		$text = Html::to_text( '<h1>Shipping</h1><p>We ship worldwide.</p><h2>Delivery times</h2><p>Two days.</p>' );

		$this->assertSame(
			"# Shipping\n\nWe ship worldwide.\n\n## Delivery times\n\nTwo days.",
			$text
		);
	}

	/**
	 * And they have to still be headings once the chunker sees them, which is
	 * the assertion that actually matters.
	 *
	 * @return void
	 */
	public function test_the_chunker_splits_a_converted_page_on_its_headings() {
		$html = '<h1>Returns</h1><p>' . str_repeat( 'Send it back within fourteen days. ', 20 ) .
			'</p><h2>Refunds</h2><p>' . str_repeat( 'Money goes back the way it came. ', 20 ) . '</p>';

		$chunks = Chunker::split(
			array(
				'id'    => 'returns',
				'title' => 'Returns',
				'text'  => Html::to_text( $html ),
			)
		);

		$this->assertCount( 2, $chunks );
		$this->assertSame( 'Returns', $chunks[0]['section'] );
		$this->assertSame( 'Returns > Refunds', $chunks[1]['section'] );
	}

	/**
	 * A list is a list.
	 *
	 * @return void
	 */
	public function test_list_items_become_lines() {
		$text = Html::to_text( '<ul><li>Small</li><li>Medium</li><li>Large</li></ul>' );

		$this->assertSame( "- Small\n- Medium\n- Large", $text );
	}

	/**
	 * A specifications table reads as facts rather than one run-on sentence.
	 *
	 * @return void
	 */
	public function test_table_rows_become_lines() {
		$text = Html::to_text( '<table><tr><td>Weight</td><td>250g</td></tr><tr><td>Roast</td><td>Medium</td></tr></table>' );

		$this->assertSame( "Weight 250g\nRoast Medium", $text );
	}

	/**
	 * Script and style content is not prose and must not reach the index.
	 *
	 * @return void
	 */
	public function test_scripts_and_styles_are_removed_not_stripped() {
		$text = Html::to_text(
			'<style>.cta{color:red}</style><script>var tracking = "delivery";</script><p>Real content.</p>'
		);

		$this->assertSame( 'Real content.', $text );
	}

	/**
	 * Block comments are on every modern post.
	 *
	 * @return void
	 */
	public function test_block_comments_are_removed() {
		$text = Html::to_text( '<!-- wp:paragraph --><p>Hello.</p><!-- /wp:paragraph -->' );

		$this->assertSame( 'Hello.', $text );
	}

	/**
	 * Entities become the characters they stand for.
	 *
	 * @return void
	 */
	public function test_entities_are_decoded() {
		$text = Html::to_text( '<p>Tea &amp; coffee &mdash; &pound;9.99&nbsp;each</p>' );

		// The dash is written as an escape rather than typed, so the character
		// under test does not become a character in this file.
		$this->assertSame( "Tea & coffee \u{2014} £9.99 each", $text );
	}

	/**
	 * A link contributes its text and not its target. The URL would be indexed
	 * as terms nobody types, and the citation the customer sees comes from the
	 * page's own permalink instead.
	 *
	 * @return void
	 */
	public function test_links_keep_their_text_and_lose_their_target() {
		$text = Html::to_text( '<p>See our <a href="https://shop.example/returns?utm_source=x">returns policy</a>.</p>' );

		$this->assertSame( 'See our returns policy .', $text );
	}

	/**
	 * An empty heading is a spacer in a page builder, not a section.
	 *
	 * @return void
	 */
	public function test_an_empty_heading_does_not_become_a_section() {
		$this->assertSame( 'Content.', Html::to_text( '<h2>  </h2><p>Content.</p>' ) );
	}

	/**
	 * Nothing in, nothing out, rather than a warning.
	 *
	 * @return void
	 */
	public function test_empty_input_is_empty_output() {
		$this->assertSame( '', Html::to_text( '' ) );
		$this->assertSame( '', Html::to_text( '<div><p>   </p></div>' ) );
	}

	/**
	 * Arabic content converts as Arabic content.
	 *
	 * @return void
	 */
	public function test_non_latin_content_survives() {
		$text = Html::to_text( '<h2>الشحن</h2><p>يستغرق التوصيل يومين.</p>' );

		$this->assertSame( "## الشحن\n\nيستغرق التوصيل يومين.", $text );
	}
}
