import { DataTypes, Sequelize } from 'sequelize'

const timestamp = () => ({
  type: DataTypes.DATE,
  allowNull: false,
  defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
})

export async function up({ context: queryInterface }) {
  await queryInterface.sequelize.transaction(
    async (transaction) => {

      // 1. MEDIA ITEMS
      await queryInterface.createTable('media_items', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        source_url: {
          type: DataTypes.TEXT,
          allowNull: false
        },
        platform: {
          type: DataTypes.STRING(50),
          allowNull: true
        },
        title: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        thumbnail_url: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        duration_seconds: {
          type: DataTypes.INTEGER,
          allowNull: true
        },
        created_at: timestamp(),
        updated_at: timestamp()
      }, { transaction })

      // 2. DOWNLOAD JOBS
      await queryInterface.createTable('download_jobs', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        media_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'media_items',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT'
        },
        source_type: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: 'link'
        },
        output_format: {
          type: DataTypes.STRING(10),
          allowNull: false
        },
        quality: {
          type: DataTypes.STRING(30),
          allowNull: true
        },
        audio_bitrate_kbps: {
          type: DataTypes.INTEGER,
          allowNull: true
        },
        status: {
          type: DataTypes.STRING(30),
          allowNull: false,
          defaultValue: 'queued'
        },
        progress: {
          type: DataTypes.FLOAT,
          allowNull: false,
          defaultValue: 0
        },
        downloaded_bytes: {
          type: DataTypes.BIGINT,
          allowNull: false,
          defaultValue: 0
        },
        error_message: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        created_at: timestamp(),
        updated_at: timestamp()
      }, { transaction })

      // 3. DOWNLOAD FILES
      await queryInterface.createTable('download_files', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        download_job_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          unique: true,
          references: {
            model: 'download_jobs',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT'
        },
        file_name: {
          type: DataTypes.TEXT,
          allowNull: false
        },
        file_path: {
          type: DataTypes.TEXT,
          allowNull: false
        },
        file_format: {
          type: DataTypes.STRING(10),
          allowNull: false
        },
        file_size: {
          type: DataTypes.BIGINT,
          allowNull: true
        },
        created_at: timestamp(),
        updated_at: timestamp()
      }, { transaction })

      // 4. APP SETTINGS
      await queryInterface.createTable('app_settings', {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        key: {
          type: DataTypes.STRING(120),
          allowNull: false,
          unique: true
        },
        value: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        created_at: timestamp(),
        updated_at: timestamp()
      }, { transaction })
    }
  )
}

export async function down({ context: queryInterface }) {
  await queryInterface.sequelize.transaction(
    async (transaction) => {
      await queryInterface.dropTable(
        'download_files',
        { transaction }
      )

      await queryInterface.dropTable(
        'download_jobs',
        { transaction }
      )

      await queryInterface.dropTable(
        'media_items',
        { transaction }
      )

      await queryInterface.dropTable(
        'app_settings',
        { transaction }
      )
    }
  )
}
