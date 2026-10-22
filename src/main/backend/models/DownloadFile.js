import { DataTypes } from 'sequelize'

export default function defineDownloadFile(sequelize) {
  return sequelize.define('DownloadFile', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    download_job_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true
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
      type: DataTypes.BIGINT
    }
  }, {
    tableName: 'download_files',
    timestamps: true,
    underscored: true
  })
}
