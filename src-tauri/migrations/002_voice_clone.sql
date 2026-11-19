-- A voice profile can be turned into a cloned voice on a cloning provider.
ALTER TABLE voice_profiles ADD COLUMN remote_voice_id TEXT;
ALTER TABLE voice_profiles ADD COLUMN remote_provider_id TEXT;
