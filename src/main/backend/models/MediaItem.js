import { DataTypes } from 'sequelize'

export default function defineMediaItem(sequelize) {
  return sequelize.define('MediaItem', {
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
      type: DataTypes.STRING(50)
    },
    title: {
      type: DataTypes.TEXT
    },
    thumbnail_url: {
      type: DataTypes.TEXT
    },
    duration_seconds: {
      type: DataTypes.INTEGER
    }
  }, {
    tableName: 'media_items',
    timestamps: true,
    underscored: true
  })
}
