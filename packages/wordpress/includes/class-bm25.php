<?php
/**
 * Okapi BM25, the same ranking the TypeScript core uses.
 *
 * Keyword retrieval is what this plugin ships with, because embeddings need a
 * credential and the shop this is for does not have one. BM25 is not a
 * consolation prize on support content: the questions are short, the answers
 * use the site's own words, and the corpus is small enough that lexical
 * matching is competitive.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Builds and searches the keyword index.
 */
class Bm25 {

	/**
	 * Term frequency saturation. Decades of retrieval papers land here.
	 */
	const K1 = 1.2;

	/**
	 * Length normalisation.
	 */
	const B = 0.75;

	/**
	 * Builds the postings table.
	 *
	 * Terms map to a flat `[ordinal, frequency, ...]` list rather than a list
	 * of pairs: half the JSON, and half the work at query time.
	 *
	 * @param array<int, string> $texts One string per chunk, in order.
	 * @return array<string, mixed>
	 */
	public static function build( $texts ) {
		$postings = array();
		$lengths  = array();
		$total    = 0;

		foreach ( array_values( $texts ) as $ord => $text ) {
			$tokens          = Tokenizer::tokenize( $text );
			$lengths[ $ord ] = count( $tokens );
			$total          += count( $tokens );

			$counts = array();
			foreach ( $tokens as $token ) {
				if ( isset( $counts[ $token ] ) ) {
					++$counts[ $token ];
				} else {
					$counts[ $token ] = 1;
				}
			}

			foreach ( $counts as $term => $frequency ) {
				// PHP turns a numeric string key into an integer, and a term
				// like "2024" is perfectly ordinary in a shop's content. Cast
				// it back on the way out or the index has integer keys where
				// the format says strings.
				$term = (string) $term;

				if ( ! isset( $postings[ $term ] ) ) {
					$postings[ $term ] = array();
				}

				$postings[ $term ][] = $ord;
				$postings[ $term ][] = $frequency;
			}
		}

		return array(
			'postings'  => $postings,
			'lengths'   => $lengths,
			'avgLength' => count( $texts ) > 0 ? $total / count( $texts ) : 0,
			'k1'        => self::K1,
			'b'         => self::B,
		);
	}

	/**
	 * How many distinct terms a query contributed, for the caller's coverage
	 * rule.
	 *
	 * @param string $query Query.
	 * @return int
	 */
	public static function query_term_count( $query ) {
		return count( array_unique( Tokenizer::tokenize( $query ) ) );
	}

	/**
	 * Scores every chunk sharing a term with the query.
	 *
	 * Cost is proportional to the postings of the query's terms rather than to
	 * the corpus, so a shop with ten thousand products answers as fast as one
	 * with ten pages.
	 *
	 * @param array<string, mixed> $index Keyword index, as built above.
	 * @param string               $query Query.
	 * @param int                  $limit Most hits to return.
	 * @return array<int, array{ord: int, score: float, matched: int}>
	 */
	public static function search( $index, $query, $limit ) {
		$terms = Tokenizer::tokenize( $query );
		if ( empty( $terms ) ) {
			return array();
		}

		$lengths        = isset( $index['lengths'] ) ? $index['lengths'] : array();
		$document_count = count( $lengths );
		if ( 0 === $document_count ) {
			return array();
		}

		$postings   = isset( $index['postings'] ) ? $index['postings'] : array();
		$k1         = isset( $index['k1'] ) ? (float) $index['k1'] : self::K1;
		$b          = isset( $index['b'] ) ? (float) $index['b'] : self::B;
		$avg_length = isset( $index['avgLength'] ) ? (float) $index['avgLength'] : 0.0;

		$scores  = array();
		$matched = array();
		$seen    = array();

		foreach ( $terms as $term ) {
			// A term repeated in the query should not count twice.
			if ( isset( $seen[ $term ] ) ) {
				continue;
			}
			$seen[ $term ] = true;

			if ( ! isset( $postings[ $term ] ) ) {
				continue;
			}

			$list       = $postings[ $term ];
			$containing = count( $list ) / 2;

			// Probabilistic IDF, smoothed by one so a term appearing in every
			// chunk scores about zero rather than going negative.
			$idf = log( 1 + ( $document_count - $containing + 0.5 ) / ( $containing + 0.5 ) );

			$count = count( $list );
			for ( $i = 0; $i < $count; $i += 2 ) {
				$ord       = (int) $list[ $i ];
				$frequency = (float) $list[ $i + 1 ];
				$length    = isset( $lengths[ $ord ] ) ? (float) $lengths[ $ord ] : 0.0;

				$norm         = 1 - $b + ( $b * $length ) / ( $avg_length > 0 ? $avg_length : 1 );
				$contribution = ( $idf * ( $frequency * ( $k1 + 1 ) ) ) / ( $frequency + $k1 * $norm );

				$scores[ $ord ]  = isset( $scores[ $ord ] ) ? $scores[ $ord ] + $contribution : $contribution;
				$matched[ $ord ] = isset( $matched[ $ord ] ) ? $matched[ $ord ] + 1 : 1;
			}
		}

		$hits = array();
		foreach ( $scores as $ord => $score ) {
			$hits[] = array(
				'ord'     => (int) $ord,
				'score'   => $score,
				'matched' => $matched[ $ord ],
			);
		}

		// Ranking only. Which of these are good enough to send to a model is a
		// retrieval policy and lives in the retriever, so it can be tuned
		// without touching the index.
		usort(
			$hits,
			/**
			 * Highest score first, and ordinal ascending on a tie.
			 *
			 * The tiebreak is not cosmetic: two chunks scoring identically is
			 * ordinary on short content, and without it the order depends on
			 * the sort's implementation and stops matching the TypeScript.
			 *
			 * @param array{ord: int, score: float} $a Left.
			 * @param array{ord: int, score: float} $b Right.
			 * @return int
			 */
			function ( $a, $b ) {
				if ( $a['score'] === $b['score'] ) {
					return $a['ord'] - $b['ord'];
				}

				return $a['score'] < $b['score'] ? 1 : -1;
			}
		);

		return array_slice( $hits, 0, $limit );
	}
}
