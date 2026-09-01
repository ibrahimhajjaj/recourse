<?php
/**
 * The endpoints people actually use, so nobody has to go and find one.
 *
 * The model settings are three free-text boxes, which is right: any service
 * speaking the OpenAI chat-completions shape works, and naming a fixed list in
 * code would date the moment somebody launches. But a blank URL box is a wall
 * for the person this plugin is for, who runs a shop rather than a terminal
 * and has no way to know that DeepSeek answers on api.deepseek.com.
 *
 * So this is a convenience and not a gate. Picking one fills the two boxes in;
 * the boxes stay editable, and "Other" leaves them alone. Every entry was
 * checked against its own documentation.
 *
 * @package Recourse
 */

namespace Recourse;

defined( 'ABSPATH' ) || exit;

/**
 * Known OpenAI-compatible endpoints.
 */
class Providers {

	/**
	 * The list, newest checked 1 September 2026.
	 *
	 * `model` is a sensible starting model rather than a recommendation, and
	 * every one of them is editable afterwards.
	 *
	 * Model names go stale faster than anything else here, and they do not fail
	 * gracefully: a retired name is a 404 on the first question a customer asks.
	 * Three were wrong when this was last checked. Two providers also disagree
	 * about punctuation, so a name cannot be inferred from a version number:
	 * Anthropic writes `claude-haiku-4-5` and xAI writes `grok-4.6`.
	 *
	 * A name being absent from a provider's list is not proof it was retired.
	 * Several are gated behind a paid tier and simply do not appear on a free
	 * key, so check against the account you actually hold.
	 *
	 * @return array<string, array{label: string, base_url: string, model: string, note: string}>
	 */
	public static function all(): array {
		return array(
			'openai'     => array(
				'label'    => 'OpenAI',
				'base_url' => 'https://api.openai.com/v1',
				'model'    => 'gpt-4o-mini',
				'note'     => __( 'Keys from platform.openai.com.', 'recourse' ),
			),
			'anthropic'  => array(
				'label'    => 'Anthropic (Claude)',
				'base_url' => 'https://api.anthropic.com/v1',
				'model'    => 'claude-haiku-4-5',
				'note'     => __( 'Uses Anthropic’s OpenAI-compatible endpoint.', 'recourse' ),
			),
			'xai'        => array(
				'label'    => 'xAI (Grok)',
				'base_url' => 'https://api.x.ai/v1',
				'model'    => 'grok-4.6',
				'note'     => __( 'Keys from console.x.ai.', 'recourse' ),
			),
			'deepseek'   => array(
				'label'    => 'DeepSeek',
				'base_url' => 'https://api.deepseek.com/v1',
				'model'    => 'deepseek-chat',
				'note'     => __( 'Inexpensive, and strong on non-English questions.', 'recourse' ),
			),
			'groq'       => array(
				'label'    => 'Groq',
				'base_url' => 'https://api.groq.com/openai/v1',
				'model'    => 'openai/gpt-oss-120b',
				'note'     => __( 'Fast, which a chat widget notices.', 'recourse' ),
			),
			'meta'       => array(
				'label'    => 'Meta',
				'base_url' => 'https://api.meta.ai/v1',
				'model'    => 'muse-spark-1.1',
				'note'     => __( 'Keys from dev.meta.ai. Thinks before answering, so replies are considered but slower.', 'recourse' ),
			),
			'openrouter' => array(
				'label'    => 'OpenRouter',
				'base_url' => 'https://openrouter.ai/api/v1',
				'model'    => 'openai/gpt-4o-mini',
				'note'     => __( 'One key, many providers behind it.', 'recourse' ),
			),
			'mistral'    => array(
				'label'    => 'Mistral',
				'base_url' => 'https://api.mistral.ai/v1',
				'model'    => 'mistral-small-latest',
				'note'     => __( 'Hosted in the EU, which some sites need.', 'recourse' ),
			),
			'moonshot'   => array(
				'label'    => 'Moonshot (Kimi)',
				'base_url' => 'https://api.moonshot.cn/v1',
				'model'    => 'moonshot-v1-8k',
				'note'     => __( 'Chinese provider. Strong on Chinese-language questions.', 'recourse' ),
			),
			'qwen'       => array(
				'label'    => 'Alibaba Qwen (DashScope)',
				'base_url' => 'https://dashscope.aliyuncs.com/compatible-mode/v1',
				'model'    => 'qwen-plus',
				'note'     => __( 'Chinese provider. Use the compatible-mode URL, not the native one.', 'recourse' ),
			),
			'zhipu'      => array(
				'label'    => 'Zhipu (GLM)',
				'base_url' => 'https://open.bigmodel.cn/api/paas/v4',
				'model'    => 'glm-4-flash',
				'note'     => __( 'Chinese provider.', 'recourse' ),
			),
			'ollama'     => array(
				'label'    => 'Ollama, on this server',
				'base_url' => 'http://localhost:11434/v1',
				'model'    => 'qwen3:4b',
				'note'     => __( 'Nothing leaves the machine, and there is nothing to pay. Needs Ollama installed and a model pulled.', 'recourse' ),
			),
		);
	}

	/**
	 * The list as the settings script needs it.
	 *
	 * @return string JSON, safe to embed in an inline script.
	 */
	public static function as_json(): string {
		$out = array();

		foreach ( self::all() as $key => $provider ) {
			$out[ $key ] = array(
				'base_url' => $provider['base_url'],
				'model'    => $provider['model'],
				'note'     => $provider['note'],
			);
		}

		// Hex flags rather than a later escaping pass: this is embedded in an
		// inline script, so the one thing that could break out of it is a
		// `</script>` arriving through a translated note. JSON escaping is the
		// correct tool here and `wp_kses` is not, since kses would mangle the
		// JSON itself.
		return (string) wp_json_encode( $out, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
	}

	/**
	 * Which entry a base URL belongs to, so the picker opens on the right one.
	 *
	 * Matched on the host rather than the whole URL, because somebody who
	 * added or removed a trailing slash has still chosen that provider.
	 *
	 * @param string $base_url The configured base URL.
	 * @return string The provider key, or an empty string for anything unrecognised.
	 */
	public static function match( string $base_url ): string {
		$host = wp_parse_url( $base_url, PHP_URL_HOST );

		if ( ! $host ) {
			return '';
		}

		foreach ( self::all() as $key => $provider ) {
			if ( wp_parse_url( $provider['base_url'], PHP_URL_HOST ) === $host ) {
				return $key;
			}
		}

		return '';
	}
}
