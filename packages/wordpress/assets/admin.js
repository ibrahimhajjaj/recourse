/*
 * Filling two text boxes from a picker.
 *
 * Deliberately plain: the settings screen loads no build step and no framework,
 * and this is the only script on it. The provider list arrives as
 * `recourseProviders`, printed before this file by wp_add_inline_script.
 */
( function () {
	var providers = window.recourseProviders || {};
	var picker = document.getElementById( 'recourse_provider' );
	var url = document.getElementById( 'recourse_model_base_url' );
	var model = document.getElementById( 'recourse_model_model' );
	var note = document.getElementById( 'recourse_provider_note' );
	var original = note ? note.textContent : '';

	if ( ! picker || ! url || ! model ) {
		return;
	}

	picker.addEventListener( 'change', function () {
		var chosen = providers[ picker.value ];

		// "Other" is a real answer, not an empty one. Somebody who picks it has
		// an endpoint of their own and their boxes are left exactly as they were.
		if ( ! chosen ) {
			if ( note ) {
				note.textContent = original;
			}
			return;
		}

		url.value = chosen.base_url;
		model.value = chosen.model;

		if ( note ) {
			note.textContent = chosen.note;
		}
	} );
}() );
