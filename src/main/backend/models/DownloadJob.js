import { DataTypes } from 'sequelize'

export default function defineDownloadJob(sequelize) {
  return sequelize.define('DownloadJob', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    media_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    source_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'link'
    },
    output_format: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: {
        isIn: [['mp4', 'mp3']]
      }
    },
    quality: {
      type: DataTypes.STRING(30)
    },
    audio_bitrate_kbps: {
      type: DataTypes.INTEGER
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
      type: DataTypes.TEXT
    }
  }, {
    tableName: 'download_jobs',
    timestamps: true,
    underscored: true
  })
}
