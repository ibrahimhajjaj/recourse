<?php
/**
 * Reading the site's own content, from the database.
 *
 * The Node core crawls a site over HTTP and parses the HTML that comes back.
 * Inside WordPress that is absurd: the content is right here, already
 * structured, already ours, and reading it costs no requests and no crawl
 * delay.
 *
 * What this has to get right is what *not* to read. A draft, a private post, a
 * password-protected page and anything a membership plugin has hidden are all
 * things the site has decided a visitor cannot see, and an index is a way to
 * leak every one of them in an answer.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Turns posts into documents.
 */
class Content {

	/**
	 * Posts read per batch.
	 *
	 * Rendering `the_content` runs every filter a site has, page builders
	 * included, which is not cheap. Shared hosting will kill a request that
	 * tries to do a thousand at once, so a rebuild walks the site in batches
	 * across cron runs.
	 */
	const BATCH = 50;

	/**
	 * Post types that can be indexed.
	 *
	 * Public types only, and attachments are excluded: their content is a
	 * caption, and indexing them fills the corpus with entries whose entire
	 * text is "IMG_4021".
	 *
	 * @return array<string, string> Slug to label.
	 */
	public static function available_post_types() {
		$types = array();

		foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $type ) {
			if ( 'attachment' === $type->name ) {
				continue;
			}

			$types[ $type->name ] = $type->labels->name;
		}

		return $types;
	}

	/**
	 * Reads one batch of documents.
	 *
	 * @param array<int, string> $post_types Post types to read.
	 * @param int                $page       1-based page number.
	 * @return array{documents: array<int, array<string, mixed>>, more: bool, total: int}
	 */
	public static function documents( $post_types, $page = 1 ) {
		$query = new \WP_Query(
			array(
				'post_type'              => $post_types,
				'post_status'            => 'publish',
				'posts_per_page'         => self::BATCH,
				'paged'                  => max( 1, (int) $page ),
				'ignore_sticky_posts'    => true,
				'no_found_rows'          => false,
				// The index is built from content, not from taxonomy or meta,
				// so caching either costs memory for nothing.
				'update_post_term_cache' => false,
				'update_post_meta_cache' => false,
				'has_password'           => false,
			)
		);

		$documents = array();

		foreach ( $query->posts as $post ) {
			$document = self::to_document( $post );

			if ( null !== $document ) {
				$documents[] = $document;
			}
		}

		wp_reset_postdata();

		return array(
			'documents' => $documents,
			'more'      => $page < (int) $query->max_num_pages,
			'total'     => (int) $query->found_posts,
		);
	}

	/**
	 * Turns one post into a document, or nothing when it should not be indexed.
	 *
	 * @param \WP_Post $post Post.
	 * @return array<string, mixed>|null
	 */
	public static function to_document( $post ) {
		// Belt and braces on top of the query's own filters. A membership
		// plugin that hides a post does it by filtering, and a plugin that
		// sets a password after the query has run is a race this loses
		// quietly.
		if ( 'publish' !== $post->post_status || '' !== $post->post_password ) {
			return null;
		}

		/**
		 * Filters whether a post is indexed.
		 *
		 * The escape hatch for anything this cannot know about: a members-only
		 * area, a landing page that should not be quoted, a post type used for
		 * layout rather than content.
		 *
		 * @param bool     $include Whether to index it.
		 * @param \WP_Post $post    The post.
		 */
		if ( ! apply_filters( 'recourse_index_post', true, $post ) ) {
			return null;
		}

		// Rendered rather than raw, so shortcodes and blocks become the words a
		// visitor actually reads. It also means every content filter on the
		// site runs, which is the expensive part and why this happens in
		// batches.
		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- applying a core filter, not declaring one.
		$rendered = apply_filters( 'the_content', $post->post_content );
		$text     = Html::to_text( $rendered );

		if ( '' === trim( $text ) ) {
			return null;
		}

		$title = html_entity_decode( get_the_title( $post ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );

		$document = array(
			'id'    => $post->post_type . '-' . $post->ID,
			'title' => $title,
			'url'   => get_permalink( $post ),
			// The title leads the text so the chunker has a heading to hang the
			// first section on, exactly as a crawled page would.
			'text'  => '# ' . $title . "\n\n" . $text,
			'meta'  => array(
				'postId'   => (int) $post->ID,
				'postType' => $post->post_type,
			),
		);

		/**
		 * Filters the document a post produces.
		 *
		 * Where a plugin adds facts the content does not carry, stock, price,
		 * delivery estimates, this is where they go in.
		 *
		 * @param array<string, mixed> $document The document.
		 * @param \WP_Post             $post     The post.
		 */
		return apply_filters( 'recourse_document', $document, $post );
	}
}
