<?php
/**
 * Proves the PHP port and the TypeScript core agree.
 *
 * The plugin exists so a shop needs no Node, which means everything the core
 * does to build and search an index had to be written twice. Two
 * implementations of one ranking drift, silently, and in the direction of
 * worse answers on whichever side is not being measured.
 *
 * So the TypeScript writes `fixtures/parity.json` and this reads it. Not a
 * sample of it: every word, every chunk, every posting, every ranking.
 *
 * Regenerate with `node tools/generate-parity-fixtures.mjs` after any change
 * to the tokeniser, the chunker or BM25 on either side.
 *
 * @package Recourse
 */

namespace Recourse\Tests;

use Recourse\Bm25;
use Recourse\Chunker;
use Recourse\Index;
use Recourse\Relevance;
use Recourse\Retriever;
use Recourse\Safety;
use Recourse\Tokenizer;
use PHPUnit\Framework\TestCase;

/**
 * Cross-language agreement.
 */
class ParityTest extends TestCase {

	/**
	 * The fixture, loaded once.
	 *
	 * @var array<string, mixed>|null
	 */
	private static $fixture = null;

	/**
	 * Reads the fixture.
	 *
	 * @return array<string, mixed>
	 */
	private function fixture() {
		if ( null === self::$fixture ) {
			$path = __DIR__ . '/fixtures/parity.json';

			$this->assertFileExists(
				$path,
				'Run `node tools/generate-parity-fixtures.mjs` first.'
			);

			self::$fixture = json_decode( file_get_contents( $path ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a fixture on disk, in a test that does not load WordPress.
		}

		return self::$fixture;
	}

	/**
	 * Parity is only claimed where the two can actually agree.
	 *
	 * Composing accents needs intl, which is not on every shared host, and the
	 * plugin is written to work without it: it builds and queries its own index
	 * either way, so it stays self-consistent. What it cannot do without intl is
	 * produce the same terms as the TypeScript tokeniser, so asserting that here
	 * would be asserting something the code does not promise.
	 *
	 * Skipped rather than quietly passing, because a run with no intl is a run
	 * that checked less than it looks like it did. CI installs it.
	 *
	 * @return void
	 */
	private function requires_composition() {
		if ( ! class_exists( '\\Normalizer' ) ) {
			$this->markTestSkipped( 'parity with the TypeScript tokeniser needs ext-intl for Unicode composition' );
		}
	}

	/**
	 * Every word stems to what the TypeScript stems it to.
	 *
	 * @return void
	 */
	public function test_tokenizer_agrees_word_for_word() {
		$this->requires_composition();
		foreach ( $this->fixture()['tokens'] as $word => $expected ) {
			$this->assertSame(
				$expected,
				Tokenizer::tokenize( (string) $word ),
				sprintf( 'tokenising "%s"', $word )
			);
		}
	}

	/**
	 * And sentence for sentence, including the ones that are not English.
	 *
	 * @return void
	 */
	public function test_tokenizer_agrees_on_whole_sentences() {
		$this->requires_composition();
		foreach ( $this->fixture()['sentences'] as $sentence => $expected ) {
			$this->assertSame(
				$expected,
				Tokenizer::tokenize( (string) $sentence ),
				sprintf( 'tokenising "%s"', $sentence )
			);
		}
	}

	/**
	 * Distinct-term counts match, which is what decides the coverage rule.
	 *
	 * @return void
	 */
	public function test_query_term_counts_agree() {
		foreach ( $this->fixture()['queryTermCounts'] as $query => $expected ) {
			$this->assertSame(
				$expected,
				Bm25::query_term_count( (string) $query ),
				sprintf( 'counting terms in "%s"', $query )
			);
		}
	}

	/**
	 * Both ports judge the same phrase relevant to the same conversation.
	 *
	 * This decides which actions reach the model, so a port that disagrees
	 * offers a site a different set of tools from the same words.
	 *
	 * @return void
	 */
	public function test_relevance_agrees() {
		foreach ( $this->fixture()['relevance'] as $case ) {
			$this->assertSame(
				$case['mentions'],
				Relevance::mentions( $case['about'], $case['conversation'] ),
				sprintf( 'is "%s" about "%s"', $case['conversation'], $case['about'] )
			);
		}
	}

	/**
	 * Compares two lists of signals, in an order neither port decides.
	 *
	 * Signals come out in whatever order the rules happen to run, which is an
	 * implementation detail on both sides, so they are sorted the way the
	 * generator sorts them before anything is compared: by category, then by
	 * score.
	 *
	 * `reason` is not compared and must not be. Those strings go through
	 * `__()` here and are written for somebody reading a transcript, so a test
	 * that insisted on them would fail the first time either side is
	 * translated or reworded.
	 *
	 * @param array<int, array<string, mixed>> $expected What the TypeScript found.
	 * @param array<int, array<string, mixed>> $actual   What this port found.
	 * @param string                           $subject  The text both looked at.
	 * @return void
	 */
	private function assert_signals_match( $expected, $actual, $subject ) {
		$found = array_map(
			function ( $signal ) {
				return array(
					'category' => $signal['category'],
					'score'    => $signal['score'],
				);
			},
			$actual
		);

		usort(
			$found,
			function ( $left, $right ) {
				$order = strcmp( $left['category'], $right['category'] );

				return 0 === $order ? $left['score'] <=> $right['score'] : $order;
			}
		);

		$this->assertCount(
			count( $expected ),
			$found,
			sprintf( 'how many signals "%s" raises', $subject )
		);

		foreach ( $expected as $position => $signal ) {
			$this->assertSame(
				$signal['category'],
				$found[ $position ]['category'],
				sprintf( 'category of signal %d for "%s"', $position, $subject )
			);
			$this->assertEqualsWithDelta(
				$signal['score'],
				$found[ $position ]['score'],
				1e-9,
				sprintf( 'score of signal %d for "%s"', $position, $subject )
			);
		}
	}

	/**
	 * The safety rules find the same things in the same message.
	 *
	 * A detector is a regular expression, and a regular expression ported by
	 * eye is one that fires on something else. The policy table goes first,
	 * because a threshold is what turns a score into a refusal: two ports that
	 * agree on every signal and disagree on one threshold still behave
	 * differently in front of a customer.
	 *
	 * The rewritten message is asserted as well as the signals, since the
	 * input rules exist to take a card number out before it goes anywhere.
	 *
	 * @return void
	 */
	public function test_safety_input_agrees() {
		$categories = Safety::categories();

		foreach ( $this->fixture()['safety']['policy'] as $name => $policy ) {
			$this->assertArrayHasKey( $name, $categories, sprintf( 'a policy for "%s"', $name ) );
			$this->assertSame(
				$policy['action'],
				$categories[ $name ]['action'],
				sprintf( 'what "%s" does', $name )
			);
			$this->assertSame(
				$policy['sensitivity'],
				$categories[ $name ]['sensitivity'],
				sprintf( 'how readily "%s" fires', $name )
			);
		}

		$thresholds = Safety::thresholds();

		foreach ( $this->fixture()['safety']['thresholds'] as $name => $expected ) {
			$this->assertArrayHasKey( $name, $thresholds, sprintf( 'a "%s" threshold', $name ) );
			$this->assertEqualsWithDelta(
				$expected,
				$thresholds[ $name ],
				1e-9,
				sprintf( 'the "%s" threshold', $name )
			);
		}

		foreach ( $this->fixture()['safety']['input'] as $case ) {
			$checked = Safety::check_input( $case['message'] );

			$this->assertSame(
				$case['text'],
				$checked['text'],
				sprintf( 'what is left of "%s"', $case['message'] )
			);

			$this->assert_signals_match( $case['signals'], $checked['signals'], $case['message'] );
		}
	}

	/**
	 * And the same of a drafted answer, against the passages behind it.
	 *
	 * Output checking is the half that catches an attack that already worked,
	 * so a port that finds nothing here looks exactly like one with nothing to
	 * find until something records what there was.
	 *
	 * @return void
	 */
	public function test_safety_output_agrees() {
		foreach ( $this->fixture()['safety']['output'] as $case ) {
			$matches = array_map(
				function ( $source ) {
					return array( 'text' => $source );
				},
				$case['sources']
			);

			$this->assert_signals_match(
				$case['signals'],
				Safety::check_output( $case['answer'], $matches ),
				$case['answer']
			);
		}
	}

	/**
	 * The chunker splits the same corpus the same way.
	 *
	 * Chunk boundaries decide what a model is shown, so a port that splits
	 * "nearly" the same is a port that answers differently.
	 *
	 * @return void
	 */
	public function test_chunker_agrees_chunk_for_chunk() {
		$expected = $this->fixture()['chunks'];

		$actual = array();
		foreach ( $this->fixture()['documents'] as $document ) {
			foreach ( Chunker::split( $document ) as $chunk ) {
				$actual[] = $chunk;
			}
		}

		$this->assertCount( count( $expected ), $actual, 'chunk count' );

		foreach ( $expected as $position => $chunk ) {
			$this->assertSame( $chunk['id'], $actual[ $position ]['id'], "chunk $position id" );
			$this->assertSame( $chunk['text'], $actual[ $position ]['text'], "chunk $position text" );
			$this->assertSame(
				isset( $chunk['section'] ) ? $chunk['section'] : null,
				isset( $actual[ $position ]['section'] ) ? $actual[ $position ]['section'] : null,
				"chunk $position section"
			);
		}
	}

	/**
	 * The postings table comes out identical, term for term and count for
	 * count.
	 *
	 * @return void
	 */
	public function test_keyword_index_agrees() {
		$expected = $this->fixture()['keyword'];

		$searchable = array();
		foreach ( $this->fixture()['chunks'] as $chunk ) {
			$parts = array();
			foreach ( array( 'title', 'section', 'text' ) as $field ) {
				if ( isset( $chunk[ $field ] ) && '' !== $chunk[ $field ] ) {
					$parts[] = $chunk[ $field ];
				}
			}
			$searchable[] = implode( "\n", $parts );
		}

		$actual = Bm25::build( $searchable );

		$this->assertSame( $expected['lengths'], $actual['lengths'], 'chunk lengths' );
		$this->assertEqualsWithDelta( $expected['avgLength'], $actual['avgLength'], 1e-9, 'average length' );

		// The BM25 constants are written into the file, so a port that used
		// different ones would produce an index the core scores differently
		// while every posting in it looked correct.
		$this->assertEqualsWithDelta( $expected['k1'], $actual['k1'], 1e-9, 'k1' );
		$this->assertEqualsWithDelta( $expected['b'], $actual['b'], 1e-9, 'b' );

		$expected_terms = array_keys( $expected['postings'] );
		$actual_terms   = array_keys( $actual['postings'] );
		sort( $expected_terms );
		sort( $actual_terms );

		// Compared as strings because PHP turns a numeric array key such as
		// "2026" into an integer, and a shop's content is full of years.
		$this->assertSame(
			array_map( 'strval', $expected_terms ),
			array_map( 'strval', $actual_terms ),
			'index terms'
		);

		foreach ( $expected['postings'] as $term => $postings ) {
			$this->assertSame(
				$postings,
				$actual['postings'][ $term ],
				sprintf( 'postings for "%s"', $term )
			);
		}
	}

	/**
	 * BM25 ranks the same chunks in the same order with the same scores.
	 *
	 * @return void
	 */
	public function test_bm25_scores_agree() {
		$index = $this->fixture()['keyword'];

		foreach ( $this->fixture()['search'] as $query => $expected ) {
			$actual = Bm25::search( $index, (string) $query, 10 );

			$this->assertCount( count( $expected ), $actual, sprintf( 'hit count for "%s"', $query ) );

			foreach ( $expected as $position => $hit ) {
				$this->assertSame(
					$hit['ord'],
					$actual[ $position ]['ord'],
					sprintf( 'rank %d for "%s"', $position, $query )
				);
				$this->assertSame(
					$hit['matched'],
					$actual[ $position ]['matched'],
					sprintf( 'matched terms at rank %d for "%s"', $position, $query )
				);
				// A float tolerance rather than equality: the arithmetic is the
				// same and the order of operations is the same, but insisting
				// on identical doubles across two runtimes is a test that will
				// fail one day for a reason nobody can act on.
				$this->assertEqualsWithDelta(
					$hit['score'],
					$actual[ $position ]['score'],
					1e-9,
					sprintf( 'score at rank %d for "%s"', $position, $query )
				);
			}
		}
	}

	/**
	 * And the whole retrieval path, filters, per-page cap and all, returns
	 * the same passages in the same order.
	 *
	 * This is the assertion that actually matters. Everything above it is a
	 * component; this is what a customer's question turns into.
	 *
	 * @return void
	 */
	public function test_retrieval_agrees_end_to_end() {
		$documents = $this->fixture()['documents'];
		$index     = Index::build( $documents );

		foreach ( $this->fixture()['retrieval'] as $query => $expected ) {
			$matches = Retriever::retrieve( $index, (string) $query );

			$this->assertSame(
				array_column( $expected, 'id' ),
				array_map(
					function ( $found ) {
						return $found['chunk']['id'];
					},
					$matches
				),
				sprintf( 'passages for "%s"', $query )
			);

			foreach ( $expected as $position => $match ) {
				$this->assertEqualsWithDelta(
					$match['score'],
					$matches[ $position ]['score'],
					1e-9,
					sprintf( 'score at rank %d for "%s"', $position, $query )
				);
			}
		}
	}

	/**
	 * An index built here parses back as the format the core reads.
	 *
	 * @return void
	 */
	public function test_index_round_trips_through_the_shared_format() {
		$index  = Index::build( $this->fixture()['documents'] );
		$parsed = Index::parse( Index::encode( $index ) );

		$this->assertNotNull( $parsed, 'an index this built should be readable' );
		$this->assertSame( 1, $parsed['version'] );
		$this->assertSame( count( $index['chunks'] ), count( $parsed['chunks'] ) );
		$this->assertSame( $index['keyword']['lengths'], $parsed['keyword']['lengths'] );
	}

	/**
	 * An empty corpus produces a readable index rather than a broken one.
	 *
	 * @return void
	 */
	public function test_an_empty_index_is_still_a_valid_index() {
		$parsed = Index::parse( Index::encode( Index::build( array() ) ) );

		$this->assertNotNull( $parsed );
		$this->assertSame( array(), $parsed['chunks'] );
		$this->assertSame( array(), Retriever::retrieve( $parsed, 'anything' ) );
	}

	/**
	 * A file from a future version is refused rather than half read.
	 *
	 * @return void
	 */
	public function test_a_future_index_version_is_refused() {
		$this->assertNull( Index::parse( '{"version":2,"chunks":[],"keyword":{}}' ) );
		$this->assertNull( Index::parse( 'not json at all' ) );
		$this->assertNull( Index::parse( '{"version":1,"chunks":[]}' ) );
	}
}
