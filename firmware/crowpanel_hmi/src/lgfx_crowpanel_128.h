#pragma once

#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include "board_config.h"

class CrowPanelLGFX : public lgfx::LGFX_Device {
public:
  CrowPanelLGFX() {
    {
      auto cfg = _bus.config();
      cfg.spi_host = SPI2_HOST;
      cfg.spi_mode = 0;
      // Conservative clocks for maximum panel compatibility.
      cfg.freq_write = 27000000;
      cfg.freq_read = 16000000;
      cfg.spi_3wire = true;
      cfg.use_lock = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk = LCD_PIN_SCLK;
      cfg.pin_mosi = LCD_PIN_MOSI;
      cfg.pin_miso = -1;
      cfg.pin_dc = LCD_PIN_DC;
      _bus.config(cfg);
      _panel.setBus(&_bus);
    }

    {
      auto cfg = _panel.config();
      cfg.pin_cs = LCD_PIN_CS;
      cfg.pin_rst = LCD_PIN_RST;
      cfg.pin_busy = -1;
      cfg.memory_width = 240;
      cfg.memory_height = 240;
      cfg.panel_width = 240;
      cfg.panel_height = 240;
      cfg.offset_x = 0;
      cfg.offset_y = 0;
      cfg.offset_rotation = 0;
      cfg.dummy_read_pixel = 8;
      cfg.dummy_read_bits = 1;
      cfg.readable = false;
      cfg.invert = true;
      cfg.rgb_order = false;
      cfg.dlen_16bit = false;
      cfg.bus_shared = false;
      _panel.config(cfg);
    }

    setPanel(&_panel);
  }

private:
  lgfx::Panel_GC9A01 _panel;
  lgfx::Bus_SPI _bus;
};
