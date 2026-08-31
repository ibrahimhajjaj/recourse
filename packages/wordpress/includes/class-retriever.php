<?php
/**
 * Deciding which passages a question gets answered from.
 *
 * The ranking is BM25 and lives next door. This is the policy on top of it:
 * what counts as good enough, how many passages one page may contribute, and
 * how many come back. Those are the numbers that decide whether the agent
 * answers a question it should have declined.
 *
 * They are the same numbers as the TypeScript core's, and they were measured
 * there rather than chosen here. The vector half of the hybrid has no
 * counterpart in this file: embeddings need a credential, and the whole point
 * of the plugin is working without one.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Keyword retrieval with the core's policy applied.
 */
class Retriever {

	/**
	 * Passages returned per question.
	 */
	const TOP_K = 6;

	/**
	 * Passages any one page may contribute, so a long page cannot fill the
	 * whole context window with near-duplicates of itself.
	 */
	const MAX_PER_DOCUMENT = 3;

	/**
	 * Over-fetch before filtering: a filter can only work on what it was given.
	 */
	const CANDIDATE_MULTIPLIER = 4;

	/**
	 * Hits scoring below this fraction of the best hit are dropped.
	 *
	 * Relative, because BM25 scores mean nothing in absolute terms, they
	 * depend on corpus size and term rarity, so only the gap to the best hit
	 * for this same query is comparable.
	 */
	const KEYWORD_FLOOR = 0.35;

	/**
	 * From this many distinct query terms onward, a passage has to contain at
	 * least two of them. Below it one is allowed, because a two-word question
	 * has no room to spare.
	 *
	 * Measured on real support content: at four terms or more a single shared
	 * word is reliably a coincidence, while at three it is often the answer.
	 */
	const COVERAGE_FROM = 4;

	/**
	 * Reciprocal rank fusion's constant, from Cormack et al. (2009).
	 *
	 * With only the keyword list to fuse this cannot change the order. It is
	 * here so the scores a passage arrives with mean the same thing they mean
	 * in the Node core, and so adding a second ranking later is a list rather
	 * than a rewrite.
	 */
	const RRF_K = 60;

	/**
	 * Finds the passages that answer a question.
	 *
	 * @param array<string, mixed> $index The parsed knowledge index.
	 * @param string               $query The customer's question.
	 * @param int                  $top_k Passages to return.
	 * @return array<int, array<string, mixed>> Each: chunk, score, from.
	 */
	public static function retrieve( $index, $query, $top_k = self::TOP_K ) {
		$chunks = isset( $index['chunks'] ) ? $index['chunks'] : array();
		if ( empty( $chunks ) ) {
			return array();
		}

		$candidates = $top_k * self::CANDIDATE_MULTIPLIER;
		$keyword    = isset( $index['keyword'] ) ? $index['keyword'] : array();
		$hits       = Bm25::search( $keyword, $query, $candidates );

		if ( empty( $hits ) ) {
			return array();
		}

		$best     = $hits[0]['score'];
		$required = Bm25::query_term_count( $query ) >= self::COVERAGE_FROM ? 2 : 1;

		$ranked = array();
		foreach ( $hits as $hit ) {
			$covered = $hit['matched'] >= $required || $hit['score'] >= $best * 0.9;

			if ( $covered && $hit['score'] >= $best * self::KEYWORD_FLOOR ) {
				$ranked[] = $hit['ord'];
			}
		}

		$matches      = array();
		$per_document = array();

		foreach ( $ranked as $rank => $ord ) {
			if ( ! isset( $chunks[ $ord ] ) ) {
				continue;
			}

			$chunk  = $chunks[ $ord ];
			$doc_id = isset( $chunk['docId'] ) ? $chunk['docId'] : '';
			$used   = isset( $per_document[ $doc_id ] ) ? $per_document[ $doc_id ] : 0;

			if ( $used >= self::MAX_PER_DOCUMENT ) {
				continue;
			}
			$per_document[ $doc_id ] = $used + 1;

			$matches[] = array(
				'chunk' => $chunk,
				'score' => 1 / ( self::RRF_K + $rank + 1 ),
				'from'  => array( 'keyword' ),
			);

			if ( count( $matches ) >= $top_k ) {
				break;
			}
		}

		return $matches;
	}
}
