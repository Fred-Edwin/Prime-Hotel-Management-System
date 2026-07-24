export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          estimated_cost_ratio: number
          id: boolean
          updated_at: string
        }
        Insert: {
          estimated_cost_ratio?: number
          id?: boolean
          updated_at?: string
        }
        Update: {
          estimated_cost_ratio?: number
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string
          changes: Json | null
          created_at: string
          id: string
          target_id: string
          target_table: string
        }
        Insert: {
          action: string
          actor_id: string
          changes?: Json | null
          created_at?: string
          id?: string
          target_id: string
          target_table: string
        }
        Update: {
          action?: string
          actor_id?: string
          changes?: Json | null
          created_at?: string
          id?: string
          target_id?: string
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      canteen_stock_purchases: {
        Row: {
          created_at: string
          created_by: string
          id: string
          item_id: string
          purchase_date: string
          quantity: number
          supplier_note: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          purchase_date: string
          quantity: number
          supplier_note?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          purchase_date?: string
          quantity?: number
          supplier_note?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "canteen_stock_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canteen_stock_purchases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      complimentary_meal_entries: {
        Row: {
          buying_price_snapshot: number
          created_at: string
          created_by: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note: string | null
          quantity: number
          staff_id: string
          value: number
        }
        Insert: {
          buying_price_snapshot: number
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note?: string | null
          quantity: number
          staff_id: string
          value: number
        }
        Update: {
          buying_price_snapshot?: number
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          location?: Database["public"]["Enums"]["location_type"]
          meal_date?: string
          note?: string | null
          quantity?: number
          staff_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "complimentary_meal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complimentary_meal_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complimentary_meal_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_locations: {
        Row: {
          active: boolean
          created_at: string
          fee: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          fee: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          fee?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          created_by: string
          expense_date: string
          id: string
          location: Database["public"]["Enums"]["location_type"] | null
          note: string | null
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          created_by: string
          expense_date: string
          id?: string
          location?: Database["public"]["Enums"]["location_type"] | null
          note?: string | null
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          created_by?: string
          expense_date?: string
          id?: string
          location?: Database["public"]["Enums"]["location_type"] | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_entries: {
        Row: {
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          ingredient_id: string
          opening_stock: number
          quantity_used: number
          received: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        Insert: {
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          created_at?: string
          created_by: string
          entry_date: string
          id?: string
          ingredient_id: string
          opening_stock?: number
          quantity_used?: number
          received?: number
          updated_at?: string
          wastage?: number
          wastage_note?: string | null
          wastage_value: number
        }
        Update: {
          buying_price_snapshot?: number
          closing_stock?: number
          closing_stock_value?: number
          created_at?: string
          created_by?: string
          entry_date?: string
          id?: string
          ingredient_id?: string
          opening_stock?: number
          quantity_used?: number
          received?: number
          updated_at?: string
          wastage?: number
          wastage_note?: string | null
          wastage_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_entries_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_purchases: {
        Row: {
          created_at: string
          created_by: string
          id: string
          ingredient_id: string
          purchase_date: string
          quantity: number
          supplier_note: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          ingredient_id: string
          purchase_date: string
          quantity: number
          supplier_note?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          ingredient_id?: string
          purchase_date?: string
          quantity?: number
          supplier_note?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_purchases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          active: boolean
          buying_price: number
          created_at: string
          id: string
          low_stock_threshold: number
          name: string
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          buying_price: number
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name: string
          unit: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          buying_price?: number
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          active: boolean
          buying_price: number
          category: Database["public"]["Enums"]["item_category"]
          created_at: string
          id: string
          low_stock_threshold: number
          name: string
          selling_price: number
          supply_type: Database["public"]["Enums"]["item_supply_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          buying_price: number
          category: Database["public"]["Enums"]["item_category"]
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name: string
          selling_price: number
          supply_type?: Database["public"]["Enums"]["item_supply_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          buying_price?: number
          category?: Database["public"]["Enums"]["item_category"]
          created_at?: string
          id?: string
          low_stock_threshold?: number
          name?: string
          selling_price?: number
          supply_type?: Database["public"]["Enums"]["item_supply_type"]
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          item_id: string
          order_id: string
          quantity: number
          selling_price_snapshot: number
        }
        Insert: {
          id?: string
          item_id: string
          order_id: string
          quantity: number
          selling_price_snapshot: number
        }
        Update: {
          id?: string
          item_id?: string
          order_id?: string
          quantity?: number
          selling_price_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          client_request_id: string
          created_at: string
          created_by: string
          customer_name: string
          delivery_fee_snapshot: number
          delivery_location_id: string | null
          fulfillment_type: Database["public"]["Enums"]["order_fulfillment_type"]
          id: string
          location: Database["public"]["Enums"]["location_type"]
          order_date: string
          total_amount: number
        }
        Insert: {
          client_request_id: string
          created_at?: string
          created_by: string
          customer_name: string
          delivery_fee_snapshot?: number
          delivery_location_id?: string | null
          fulfillment_type: Database["public"]["Enums"]["order_fulfillment_type"]
          id?: string
          location: Database["public"]["Enums"]["location_type"]
          order_date: string
          total_amount: number
        }
        Update: {
          client_request_id?: string
          created_at?: string
          created_by?: string
          customer_name?: string
          delivery_fee_snapshot?: number
          delivery_location_id?: string | null
          fulfillment_type?: Database["public"]["Enums"]["order_fulfillment_type"]
          id?: string
          location?: Database["public"]["Enums"]["location_type"]
          order_date?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_location_id_fkey"
            columns: ["delivery_location_id"]
            isOneToOne: false
            referencedRelation: "delivery_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_meal_entries: {
        Row: {
          buying_price_snapshot: number
          created_at: string
          created_by: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note: string | null
          quantity: number
          staff_id: string
          value: number
        }
        Insert: {
          buying_price_snapshot: number
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note?: string | null
          quantity: number
          staff_id: string
          value: number
        }
        Update: {
          buying_price_snapshot?: number
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          location?: Database["public"]["Enums"]["location_type"]
          meal_date?: string
          note?: string | null
          quantity?: number
          staff_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_meal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_meal_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_meal_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustment_entries: {
        Row: {
          buying_price_snapshot: number
          created_at: string
          created_by: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note: string | null
          quantity: number
          staff_id: string
          value: number
        }
        Insert: {
          buying_price_snapshot: number
          created_at?: string
          created_by: string
          id?: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note?: string | null
          quantity: number
          staff_id: string
          value: number
        }
        Update: {
          buying_price_snapshot?: number
          created_at?: string
          created_by?: string
          id?: string
          item_id?: string
          location?: Database["public"]["Enums"]["location_type"]
          meal_date?: string
          note?: string | null
          quantity?: number
          staff_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_entries: {
        Row: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        Insert: {
          added_stock?: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at?: string
          created_by: string
          entry_date: string
          id?: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock?: number
          quantity_sold?: number
          sales_value: number
          selling_price_snapshot: number
          sent_out?: number
          till_quantity_sold?: number
          updated_at?: string
          wastage?: number
          wastage_note?: string | null
          wastage_value: number
        }
        Update: {
          added_stock?: number
          buying_price_snapshot?: number
          closing_stock?: number
          closing_stock_value?: number
          cost_value?: number
          created_at?: string
          created_by?: string
          entry_date?: string
          id?: string
          item_id?: string
          location?: Database["public"]["Enums"]["location_type"]
          opening_stock?: number
          quantity_sold?: number
          sales_value?: number
          selling_price_snapshot?: number
          sent_out?: number
          till_quantity_sold?: number
          updated_at?: string
          wastage?: number
          wastage_note?: string | null
          wastage_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_store_manager: boolean
          location: Database["public"]["Enums"]["location_type"] | null
          name: string
          role: Database["public"]["Enums"]["user_role"]
          staff_code: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id: string
          is_store_manager?: boolean
          location?: Database["public"]["Enums"]["location_type"] | null
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          staff_code: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_store_manager?: boolean
          location?: Database["public"]["Enums"]["location_type"] | null
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
          staff_code?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_order_to_stock_entry: {
        Args: {
          p_buying_price_snapshot: number
          p_created_by: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_order_date: string
          p_selling_price_snapshot: number
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      canteen_supplied_total: {
        Args: { p_item_id: string; p_week_end: string; p_week_start: string }
        Returns: number
      }
      canteen_supplied_totals_batch: {
        Args: { p_date: string; p_item_ids: string[] }
        Returns: {
          item_id: string
          total: number
        }[]
      }
      complimentary_meal_available_stock: {
        Args: {
          p_as_of_date: string
          p_location: Database["public"]["Enums"]["location_type"]
        }
        Returns: {
          available: number
          item_id: string
        }[]
      }
      complimentary_meals_total: {
        Args: {
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_period_end: string
          p_period_start: string
        }
        Returns: number
      }
      create_complimentary_meal_entry: {
        Args: {
          p_created_by: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_meal_date: string
          p_note?: string
          p_quantity: number
          p_staff_id: string
        }
        Returns: {
          buying_price_snapshot: number
          created_at: string
          created_by: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note: string | null
          quantity: number
          staff_id: string
          value: number
        }
        SetofOptions: {
          from: "*"
          to: "complimentary_meal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_order: {
        Args: {
          p_buying_prices: Json
          p_client_request_id: string
          p_created_by: string
          p_customer_name: string
          p_delivery_fee_snapshot?: number
          p_delivery_location_id?: string
          p_fulfillment_type: Database["public"]["Enums"]["order_fulfillment_type"]
          p_items: Json
          p_location: Database["public"]["Enums"]["location_type"]
          p_order_date: string
          p_total_amount: number
        }
        Returns: {
          client_request_id: string
          created_at: string
          created_by: string
          customer_name: string
          delivery_fee_snapshot: number
          delivery_location_id: string | null
          fulfillment_type: Database["public"]["Enums"]["order_fulfillment_type"]
          id: string
          location: Database["public"]["Enums"]["location_type"]
          order_date: string
          total_amount: number
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_staff_meal_entry: {
        Args: {
          p_created_by: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_meal_date: string
          p_note?: string
          p_quantity: number
          p_staff_id: string
        }
        Returns: {
          buying_price_snapshot: number
          created_at: string
          created_by: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note: string | null
          quantity: number
          staff_id: string
          value: number
        }
        SetofOptions: {
          from: "*"
          to: "staff_meal_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_stock_adjustment_entry: {
        Args: {
          p_created_by: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_meal_date: string
          p_note?: string
          p_quantity: number
          p_staff_id: string
        }
        Returns: {
          buying_price_snapshot: number
          created_at: string
          created_by: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note: string | null
          quantity: number
          staff_id: string
          value: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_adjustment_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dashboard_complimentary_meal_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          location: Database["public"]["Enums"]["location_type"]
          value: number
        }[]
      }
      dashboard_daily_trend: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cost_value: number
          entry_date: string
          sales_value: number
          wastage_value: number
        }[]
      }
      dashboard_expenses_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          location: Database["public"]["Enums"]["location_type"]
          total_amount: number
        }[]
      }
      dashboard_ingredient_ledger: {
        Args: { p_from: string; p_to: string }
        Returns: {
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          entry_date: string
          ingredient_id: string
          ingredient_name: string
          low_stock_threshold: number
          opening_stock: number
          quantity_used: number
          received: number
          unit: string
          wastage: number
          wastage_value: number
        }[]
      }
      dashboard_ingredient_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          closing_stock: number
          closing_stock_value: number
          opening_stock: number
          opening_stock_value: number
          quantity_used: number
          received: number
          received_value: number
          wastage_value: number
        }[]
      }
      dashboard_item_ledger: {
        Args: {
          p_from: string
          p_location?: Database["public"]["Enums"]["location_type"]
          p_to: string
        }
        Returns: {
          added_stock: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          entry_date: string
          item_id: string
          item_name: string
          location: Database["public"]["Enums"]["location_type"]
          low_stock_threshold: number
          non_sales_consumption: number
          non_sales_consumption_value: number
          opening_stock: number
          quantity_sold: number
          sales_value: number
          sent_out: number
          till_quantity_sold: number
          wastage: number
          wastage_value: number
        }[]
      }
      dashboard_low_stock_ingredients: {
        Args: never
        Returns: {
          closing_stock: number
          entry_date: string
          ingredient_id: string
          ingredient_name: string
          low_stock_threshold: number
          unit: string
        }[]
      }
      dashboard_low_stock_items: {
        Args: never
        Returns: {
          closing_stock: number
          entry_date: string
          item_id: string
          item_name: string
          location: Database["public"]["Enums"]["location_type"]
          low_stock_threshold: number
        }[]
      }
      dashboard_staff_meal_ledger: {
        Args: {
          p_from: string
          p_location?: Database["public"]["Enums"]["location_type"]
          p_to: string
        }
        Returns: {
          item_id: string
          item_name: string
          location: Database["public"]["Enums"]["location_type"]
          meal_date: string
          note: string
          quantity: number
          staff_id: string
          staff_name: string
          value: number
        }[]
      }
      dashboard_staff_meal_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          location: Database["public"]["Enums"]["location_type"]
          value: number
        }[]
      }
      dashboard_stock_adjustment_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          location: Database["public"]["Enums"]["location_type"]
          value: number
        }[]
      }
      dashboard_stock_consumption_ledger: {
        Args: {
          p_from: string
          p_location?: Database["public"]["Enums"]["location_type"]
          p_to: string
        }
        Returns: {
          category: string
          entry_date: string
          ingredient_id: string
          ingredient_name: string
          item_id: string
          item_name: string
          location: Database["public"]["Enums"]["location_type"]
          note: string
          quantity: number
          staff_id: string
          staff_name: string
          unit: string
          value: number
        }[]
      }
      dashboard_stock_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          added_stock: number
          added_stock_value: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          opening_stock_value: number
          quantity_sold: number
          sales_value: number
          sent_out: number
          wastage_value: number
        }[]
      }
      delete_canteen_stock_purchase: {
        Args: { p_purchase_id: string }
        Returns: undefined
      }
      delete_delivery_location: {
        Args: { p_delivery_location_id: string }
        Returns: undefined
      }
      delete_expense_category: {
        Args: { p_expense_category_id: string }
        Returns: undefined
      }
      delete_ingredient: {
        Args: { p_ingredient_id: string }
        Returns: undefined
      }
      delete_ingredient_purchase: {
        Args: { p_purchase_id: string }
        Returns: undefined
      }
      delete_item: { Args: { p_item_id: string }; Returns: undefined }
      delivery_location_delete_impact: {
        Args: { p_delivery_location_id: string }
        Returns: {
          orders_affected_count: number
          orders_delivery_fee_value: number
        }[]
      }
      expense_category_delete_impact: {
        Args: { p_expense_category_id: string }
        Returns: {
          expenses_count: number
          expenses_value: number
        }[]
      }
      ingredient_delete_impact: {
        Args: { p_ingredient_id: string }
        Returns: {
          ingredient_entries_closing_value: number
          ingredient_entries_count: number
          ingredient_purchases_count: number
          ingredient_purchases_value: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      item_delete_impact: {
        Args: { p_item_id: string }
        Returns: {
          canteen_purchases_count: number
          canteen_purchases_value: number
          orders_affected_count: number
          orders_to_delete_count: number
          staff_meal_entries_count: number
          stock_entries_count: number
          stock_entries_sales_value: number
        }[]
      }
      items_profit_by_range: {
        Args: {
          p_from: string
          p_location?: Database["public"]["Enums"]["location_type"]
          p_to: string
        }
        Returns: {
          item_id: string
          profit: number
        }[]
      }
      lock_ingredient_entry_row: {
        Args: { p_entry_date: string; p_ingredient_id: string }
        Returns: undefined
      }
      lock_stock_entry_row: {
        Args: {
          p_entry_date: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
        }
        Returns: undefined
      }
      login_roster: {
        Args: never
        Returns: {
          name: string
        }[]
      }
      my_location: {
        Args: never
        Returns: Database["public"]["Enums"]["location_type"]
      }
      rebuild_canteen_item_buying_price: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      rebuild_ingredient_buying_price: {
        Args: { p_ingredient_id: string }
        Returns: undefined
      }
      recompute_ingredient_entry_chain: {
        Args: { p_from_date: string; p_ingredient_id: string }
        Returns: {
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          ingredient_id: string
          opening_stock: number
          quantity_used: number
          received: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ingredient_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      recompute_stock_entry_cascade: {
        Args: {
          p_edited_from_date: string
          p_edited_location: Database["public"]["Enums"]["location_type"]
          p_item_id: string
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      recompute_stock_entry_chain: {
        Args: {
          p_from_date: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_canteen_stock_purchase: {
        Args: {
          p_created_by: string
          p_item_id: string
          p_purchase_date: string
          p_quantity: number
          p_supplier_note?: string
          p_unit_cost: number
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          item_id: string
          purchase_date: string
          quantity: number
          supplier_note: string | null
          total_cost: number
          unit_cost: number
        }
        SetofOptions: {
          from: "*"
          to: "canteen_stock_purchases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_ingredient_purchase: {
        Args: {
          p_created_by: string
          p_ingredient_id: string
          p_purchase_date: string
          p_quantity: number
          p_supplier_note?: string
          p_unit_cost: number
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          ingredient_id: string
          purchase_date: string
          quantity: number
          supplier_note: string | null
          total_cost: number
          unit_cost: number
        }
        SetofOptions: {
          from: "*"
          to: "ingredient_purchases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_canteen_stock_entries_batch: {
        Args: { p_created_by: string; p_entry_date: string; p_lines: Json }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_canteen_stock_entry: {
        Args: {
          p_added_stock_input: number
          p_buying_price_snapshot: number
          p_created_by: string
          p_entry_date: string
          p_is_canteen_supplied: boolean
          p_item_id: string
          p_selling_price_snapshot: number
          p_till_quantity_sold: number
          p_wastage?: number
          p_wastage_note?: string
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_ingredient_entries_batch: {
        Args: { p_created_by: string; p_entry_date: string; p_lines: Json }
        Returns: {
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          ingredient_id: string
          opening_stock: number
          quantity_used: number
          received: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ingredient_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_ingredient_entry: {
        Args: {
          p_buying_price_snapshot: number
          p_created_by: string
          p_entry_date: string
          p_ingredient_id: string
          p_quantity_used: number
          p_received: number
          p_wastage: number
          p_wastage_note?: string
        }
        Returns: {
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          ingredient_id: string
          opening_stock: number
          quantity_used: number
          received: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        SetofOptions: {
          from: "*"
          to: "ingredient_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_stock_entries_batch: {
        Args: {
          p_created_by: string
          p_entry_date: string
          p_lines: Json
          p_location: Database["public"]["Enums"]["location_type"]
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_stock_entry: {
        Args: {
          p_added_stock?: number
          p_buying_price_snapshot: number
          p_created_by: string
          p_entry_date: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_selling_price_snapshot: number
          p_sent_out?: number
          p_till_quantity_sold: number
          p_wastage?: number
          p_wastage_note?: string
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_stock_entry_canteen_field: {
        Args: {
          p_added_stock_input?: number
          p_buying_price_snapshot?: number
          p_created_by?: string
          p_entry_date: string
          p_is_canteen_supplied: boolean
          p_item_id: string
          p_selling_price_snapshot?: number
          p_till_quantity_sold?: number
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_stock_entry_cashier_field: {
        Args: {
          p_buying_price_snapshot: number
          p_created_by: string
          p_entry_date: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_selling_price_snapshot: number
          p_till_quantity_sold: number
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_stock_entry_store_manager_fields: {
        Args: {
          p_added_stock: number
          p_buying_price_snapshot: number
          p_created_by: string
          p_entry_date: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_selling_price_snapshot: number
          p_sent_out: number
        }
        Returns: {
          added_stock: number
          buying_price_snapshot: number
          closing_stock: number
          closing_stock_value: number
          cost_value: number
          created_at: string
          created_by: string
          entry_date: string
          id: string
          item_id: string
          location: Database["public"]["Enums"]["location_type"]
          opening_stock: number
          quantity_sold: number
          sales_value: number
          selling_price_snapshot: number
          sent_out: number
          till_quantity_sold: number
          updated_at: string
          wastage: number
          wastage_note: string | null
          wastage_value: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      staff_meal_available_stock: {
        Args: {
          p_as_of_date: string
          p_location: Database["public"]["Enums"]["location_type"]
        }
        Returns: {
          available: number
          item_id: string
        }[]
      }
      staff_meals_total: {
        Args: {
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_period_end: string
          p_period_start: string
        }
        Returns: number
      }
      stock_adjustment_available_stock: {
        Args: {
          p_as_of_date: string
          p_location: Database["public"]["Enums"]["location_type"]
        }
        Returns: {
          available: number
          item_id: string
        }[]
      }
      stock_adjustments_total: {
        Args: {
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_period_end: string
          p_period_start: string
        }
        Returns: number
      }
      write_audit_log: {
        Args: {
          p_action: string
          p_actor_id: string
          p_changes?: Json
          p_target_id: string
          p_target_table: string
        }
        Returns: undefined
      }
    }
    Enums: {
      expense_category: "electricity" | "gas" | "charcoal" | "other"
      item_category:
        | "beverages"
        | "snacks"
        | "meals"
        | "fruits"
        | "cyber"
        | "retail"
        | "ingredients"
        | "stationery"
        | "dawa"
        | "sweets"
        | "biscuits"
        | "packing_supplies"
        | "others"
      item_supply_type:
        | "restaurant_only"
        | "canteen_supplied"
        | "canteen_independent"
      location_type: "restaurant" | "canteen"
      order_fulfillment_type: "delivery" | "pickup"
      user_role: "admin" | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      expense_category: ["electricity", "gas", "charcoal", "other"],
      item_category: [
        "beverages",
        "snacks",
        "meals",
        "fruits",
        "cyber",
        "retail",
        "ingredients",
        "stationery",
        "dawa",
        "sweets",
        "biscuits",
        "packing_supplies",
        "others",
      ],
      item_supply_type: [
        "restaurant_only",
        "canteen_supplied",
        "canteen_independent",
      ],
      location_type: ["restaurant", "canteen"],
      order_fulfillment_type: ["delivery", "pickup"],
      user_role: ["admin", "staff"],
    },
  },
} as const
