<?php
/**
 * The settings screen.
 *
 * @package Helpdeck
 */

namespace Helpdeck;

defined( 'ABSPATH' ) || exit;

/**
 * Registers and renders the admin screen.
 */
class Admin {

	/**
	 * Hooks everything up.
	 *
	 * @return void
	 */
	public static function register() {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_setting' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_assets' ) );
		add_action( 'admin_post_helpdeck_rebuild', array( __CLASS__, 'handle_rebuild' ) );
		add_action( 'admin_post_helpdeck_test', array( __CLASS__, 'handle_test' ) );
		add_action( 'admin_notices', array( __CLASS__, 'notices' ) );
	}

	/**
	 * Under Settings rather than a top-level menu.
	 *
	 * A support agent is something a site is configured with, not a section of
	 * the admin, and a plugin that plants itself in the sidebar is the kind of
	 * thing the directory's guidelines call hijacking the dashboard.
	 *
	 * @return void
	 */
	public static function add_page() {
		add_options_page(
			__( 'Helpdeck Assistant', 'helpdeck' ),
			__( 'Helpdeck', 'helpdeck' ),
			'manage_options',
			'helpdeck',
			array( __CLASS__, 'render_page' )
		);
	}

	/**
	 * Registers the setting.
	 *
	 * @return void
	 */
	public static function register_setting() {
		register_setting(
			'helpdeck',
			'helpdeck_settings',
			array(
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
			)
		);
	}

	/**
	 * Carries the stored key across a save, then hands off.
	 *
	 * The key field renders empty, because a credential echoed into a page is a
	 * credential in a screenshot. That means every save posts an empty string,
	 * and without this a change of accent colour would delete a working key and
	 * the next visitor's question would fail.
	 *
	 * @param mixed $input Raw input.
	 * @return array<string, mixed>
	 */
	public static function sanitize( $input ) {
		if ( is_array( $input ) && ! Settings::key_is_a_constant() ) {
			if ( ! isset( $input['model'] ) || ! is_array( $input['model'] ) ) {
				$input['model'] = array();
			}

			$posted = isset( $input['model']['api_key'] ) ? (string) $input['model']['api_key'] : '';

			if ( '' === trim( $posted ) ) {
				$stored                    = Settings::all();
				$input['model']['api_key'] = $stored['model']['api_key'];
			}
		}

		$clean = Settings::sanitize( $input );

		// A key that lives in `wp-config.php` must never be copied into the
		// options table, which is exactly what storing the resolved value would
		// do and exactly what putting it in a constant was meant to avoid.
		if ( Settings::key_is_a_constant() && isset( $clean['model']['api_key'] ) ) {
			unset( $clean['model']['api_key'] );
		}

		return $clean;
	}

	/**
	 * The stylesheet, on this screen and nowhere else.
	 *
	 * @param string $hook The current admin page.
	 * @return void
	 */
	public static function enqueue_assets( $hook ) {
		if ( 'settings_page_helpdeck' !== $hook ) {
			return;
		}

		wp_enqueue_style(
			'helpdeck-admin',
			HELPDECK_URL . 'assets/admin.css',
			array(),
			HELPDECK_VERSION
		);
	}

	/**
	 * Handles the rebuild button.
	 *
	 * @return void
	 */
	public static function handle_rebuild() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'helpdeck' ) );
		}

		check_admin_referer( 'helpdeck_rebuild' );

		Indexer::start();

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'             => 'helpdeck',
					'helpdeck_rebuilt' => '1',
				),
				admin_url( 'options-general.php' )
			)
		);
		exit;
	}

	/**
	 * Handles the test button.
	 *
	 * @return void
	 */
	public static function handle_test() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'helpdeck' ) );
		}

		check_admin_referer( 'helpdeck_test' );

		$settings = Settings::all();
		$result   = Model::check( $settings['model'] );

		set_transient( 'helpdeck_test_result_' . get_current_user_id(), $result, 30 );

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'            => 'helpdeck',
					'helpdeck_tested' => '1',
				),
				admin_url( 'options-general.php' )
			)
		);
		exit;
	}

	/**
	 * Notices, on this screen only.
	 *
	 * Bailing on any other screen is the whole point: an admin notice that
	 * follows the user around the dashboard is what everybody complains about
	 * and what the guidelines are aimed at.
	 *
	 * @return void
	 */
	public static function notices() {
		$screen = get_current_screen();

		if ( ! $screen || 'settings_page_helpdeck' !== $screen->id ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag on our own redirect.
		$rebuilt = isset( $_GET['helpdeck_rebuilt'] ) ? sanitize_text_field( wp_unslash( $_GET['helpdeck_rebuilt'] ) ) : '';

		if ( '1' === $rebuilt ) {
			?>
			<div class="notice notice-success is-dismissible">
				<p><?php esc_html_e( 'Index rebuild started. It runs in the background.', 'helpdeck' ); ?></p>
			</div>
			<?php
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag on our own redirect.
		$tested = isset( $_GET['helpdeck_tested'] ) ? sanitize_text_field( wp_unslash( $_GET['helpdeck_tested'] ) ) : '';

		if ( '1' !== $tested ) {
			return;
		}

		// Keyed by user: two administrators testing at the same time would
		// otherwise read each other's result.
		$key    = 'helpdeck_test_result_' . get_current_user_id();
		$result = get_transient( $key );
		delete_transient( $key );

		if ( ! is_array( $result ) ) {
			return;
		}

		if ( ! empty( $result['ok'] ) ) {
			?>
			<div class="notice notice-success is-dismissible">
				<p><?php esc_html_e( 'Connection successful.', 'helpdeck' ); ?></p>
			</div>
			<?php
			return;
		}
		?>
		<div class="notice notice-error is-dismissible">
			<p>
				<?php
				/* translators: %s is the reason the connection failed. */
				echo esc_html( sprintf( __( 'Connection failed: %s', 'helpdeck' ), $result['error'] ) );
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * Renders the page.
	 *
	 * @return void
	 */
	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings = Settings::all();
		$status   = Storage::status();
		$ready    = Settings::ready();
		$progress = Indexer::progress();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Helpdeck Assistant', 'helpdeck' ); ?></h1>

			<div class="notice inline helpdeck-status-box <?php echo esc_attr( $ready ? 'notice-success' : 'notice-warning' ); ?>">
				<?php if ( $ready ) : ?>
					<p><strong><?php esc_html_e( 'The assistant is ready.', 'helpdeck' ); ?></strong></p>
				<?php else : ?>
					<p><strong><?php esc_html_e( 'The assistant is not ready yet.', 'helpdeck' ); ?></strong></p>
				<?php endif; ?>
				<ul>
					<li>
						<?php
						if ( $settings['enabled'] ) {
							esc_html_e( 'The assistant is enabled.', 'helpdeck' );
						} else {
							esc_html_e( 'The assistant is disabled.', 'helpdeck' );
						}
						?>
					</li>
					<li>
						<?php
						if ( '' !== $settings['model']['base_url'] && '' !== $settings['model']['model'] ) {
							esc_html_e( 'The model is configured.', 'helpdeck' );
						} elseif ( Settings::has_a_model() ) {
							esc_html_e( "This site's own AI connector will be used, so there is nothing to configure here.", 'helpdeck' );
						} else {
							esc_html_e( 'The model is not fully configured.', 'helpdeck' );
						}
						?>
					</li>
					<li>
						<?php
						if ( $status['exists'] ) {
							/* translators: 1: number of documents, 2: formatted file size */
							echo esc_html( sprintf( __( 'The index holds %1$d documents (%2$s).', 'helpdeck' ), $status['documents'], size_format( $status['bytes'] ) ) );
						} else {
							esc_html_e( 'The index has not been built.', 'helpdeck' );
						}
						?>
					</li>
					<?php if ( $progress['running'] ) : ?>
						<li>
							<?php
							// A rebuild runs one batch a minute, so on a large
							// site this box is the only sign anything is
							// happening for several minutes.
							/* translators: %d: documents read so far */
							echo esc_html( sprintf( __( 'A rebuild is running. %d documents read so far.', 'helpdeck' ), $progress['documents'] ) );
							?>
						</li>
					<?php endif; ?>
				</ul>
			</div>

			<form method="post" action="options.php">
				<?php
				settings_fields( 'helpdeck' );
				?>
				<table class="form-table">
					<tr>
						<th scope="row">
							<label for="helpdeck_enabled"><?php esc_html_e( 'Enable the assistant', 'helpdeck' ); ?></label>
						</th>
						<td>
							<input type="checkbox" id="helpdeck_enabled" name="<?php echo esc_attr( Settings::OPTION ); ?>[enabled]" value="1" <?php checked( $settings['enabled'], true ); ?> />
						</td>
					</tr>

					<tr>
						<th scope="row"><?php esc_html_e( 'Post types to index', 'helpdeck' ); ?></th>
						<td>
							<fieldset>
								<legend class="screen-reader-text"><span><?php esc_html_e( 'Post types to index', 'helpdeck' ); ?></span></legend>
								<?php
								$available = Content::available_post_types();
								foreach ( $available as $type => $label ) {
									$checked = in_array( $type, $settings['post_types'], true );
									?>
									<label>
										<input type="checkbox" name="<?php echo esc_attr( Settings::OPTION ); ?>[post_types][]" value="<?php echo esc_attr( $type ); ?>" <?php checked( $checked, true ); ?> />
										<?php echo esc_html( $label ); ?>
									</label><br>
									<?php
								}
								?>
							</fieldset>
						</td>
					</tr>

					<tr>
						<th scope="row"><label for="helpdeck_persona_name"><?php esc_html_e( 'Persona Name', 'helpdeck' ); ?></label></th>
						<td>
							<input type="text" id="helpdeck_persona_name" name="<?php echo esc_attr( Settings::OPTION ); ?>[persona][name]" value="<?php echo esc_attr( $settings['persona']['name'] ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="helpdeck_persona_business"><?php esc_html_e( 'Business Name', 'helpdeck' ); ?></label></th>
						<td>
							<input type="text" id="helpdeck_persona_business" name="<?php echo esc_attr( Settings::OPTION ); ?>[persona][business]" value="<?php echo esc_attr( $settings['persona']['business'] ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="helpdeck_persona_greeting"><?php esc_html_e( 'Greeting', 'helpdeck' ); ?></label></th>
						<td>
							<input type="text" id="helpdeck_persona_greeting" name="<?php echo esc_attr( Settings::OPTION ); ?>[persona][greeting]" value="<?php echo esc_attr( $settings['persona']['greeting'] ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="helpdeck_persona_fallback"><?php esc_html_e( 'Fallback Message', 'helpdeck' ); ?></label></th>
						<td>
							<input type="text" id="helpdeck_persona_fallback" name="<?php echo esc_attr( Settings::OPTION ); ?>[persona][fallback]" value="<?php echo esc_attr( $settings['persona']['fallback'] ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="helpdeck_persona_instructions"><?php esc_html_e( 'Extra Instructions', 'helpdeck' ); ?></label></th>
						<td>
							<textarea id="helpdeck_persona_instructions" name="<?php echo esc_attr( Settings::OPTION ); ?>[persona][instructions]" class="large-text" rows="5"><?php echo esc_textarea( $settings['persona']['instructions'] ); ?></textarea>
						</td>
					</tr>

					<tr>
						<th scope="row"><label for="helpdeck_model_base_url"><?php esc_html_e( 'Model Base URL', 'helpdeck' ); ?></label></th>
						<td>
							<input type="url" id="helpdeck_model_base_url" name="<?php echo esc_attr( Settings::OPTION ); ?>[model][base_url]" value="<?php echo esc_attr( $settings['model']['base_url'] ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="helpdeck_model_model"><?php esc_html_e( 'Model Name', 'helpdeck' ); ?></label></th>
						<td>
							<input type="text" id="helpdeck_model_model" name="<?php echo esc_attr( Settings::OPTION ); ?>[model][model]" value="<?php echo esc_attr( $settings['model']['model'] ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="helpdeck_model_api_key"><?php esc_html_e( 'API Key', 'helpdeck' ); ?></label></th>
						<td>
							<?php if ( Settings::key_is_a_constant() ) : ?>
								<p class="description"><?php esc_html_e( 'The API key is provided by a constant in wp-config.php.', 'helpdeck' ); ?></p>
							<?php else : ?>
								<input type="password" id="helpdeck_model_api_key" name="<?php echo esc_attr( Settings::OPTION ); ?>[model][api_key]" value="" class="regular-text" autocomplete="new-password" />
								<p class="description"><?php esc_html_e( 'Enter a new key to change it. Leave blank to keep the current key.', 'helpdeck' ); ?></p>
							<?php endif; ?>
						</td>
					</tr>

					<tr>
						<th scope="row"><label for="helpdeck_appearance_accent"><?php esc_html_e( 'Accent Color', 'helpdeck' ); ?></label></th>
						<td>
							<input type="color" id="helpdeck_appearance_accent" name="<?php echo esc_attr( Settings::OPTION ); ?>[appearance][accent]" value="<?php echo esc_attr( $settings['appearance']['accent'] ); ?>" />
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Position', 'helpdeck' ); ?></th>
						<td>
							<fieldset>
								<legend class="screen-reader-text"><span><?php esc_html_e( 'Position', 'helpdeck' ); ?></span></legend>
								<label>
									<input type="radio" name="<?php echo esc_attr( Settings::OPTION ); ?>[appearance][position]" value="right" <?php checked( $settings['appearance']['position'], 'right' ); ?> />
									<?php esc_html_e( 'Right', 'helpdeck' ); ?>
								</label><br>
								<label>
									<input type="radio" name="<?php echo esc_attr( Settings::OPTION ); ?>[appearance][position]" value="left" <?php checked( $settings['appearance']['position'], 'left' ); ?> />
									<?php esc_html_e( 'Left', 'helpdeck' ); ?>
								</label>
							</fieldset>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>

			<h2><?php esc_html_e( 'Tools', 'helpdeck' ); ?></h2>
			<div class="helpdeck-tools">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<?php wp_nonce_field( 'helpdeck_rebuild' ); ?>
					<input type="hidden" name="action" value="helpdeck_rebuild" />
					<?php submit_button( __( 'Rebuild Index', 'helpdeck' ), 'secondary', 'submit', false ); ?>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<?php wp_nonce_field( 'helpdeck_test' ); ?>
					<input type="hidden" name="action" value="helpdeck_test" />
					<?php submit_button( __( 'Test Connection', 'helpdeck' ), 'secondary', 'submit', false ); ?>
				</form>
			</div>
		</div>
		<?php
	}
}
