mod commands;
mod credentials;
mod db;
mod error;
mod paths;
mod providers;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let database = db::Db::open(&data_dir)?;
            app.manage(database);
            app.manage(paths::AppPaths::new(&data_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::providers::list_providers,
            commands::providers::save_provider,
            commands::providers::delete_provider,
            commands::providers::clear_api_key,
            commands::providers::test_provider,
            commands::providers::set_default,
            commands::providers::get_defaults,
            commands::providers::set_fallback_chain,
            commands::providers::get_fallback_chains,
            commands::ai::ai_generate,
            commands::image::ai_generate_image,
            commands::media::save_media,
            commands::media::read_media,
            commands::library::list_projects,
            commands::library::create_project,
            commands::library::rename_project,
            commands::library::delete_project,
            commands::library::save_asset,
            commands::library::list_assets,
            commands::library::get_asset,
            commands::library::delete_asset,
            commands::files::export_file,
            commands::files::import_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kothok");
}
