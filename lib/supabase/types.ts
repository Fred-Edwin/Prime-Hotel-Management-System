export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string
          expense_date: string
          id: string
          location: Database["public"]["Enums"]["location_type"]
          note: string | null
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by: string
          expense_date: string
          id?: string
          location: Database["public"]["Enums"]["location_type"]
          note?: string | null
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string
          expense_date?: string
          id?: string
          location?: Database["public"]["Enums"]["location_type"]
          note?: string | null
        }
        Relationships: [
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
      ingredients: {
        Row: {
          active: boolean
          buying_price: number
          created_at: string
          id: string
          name: string
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          buying_price: number
          created_at?: string
          id?: string
          name: string
          unit: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          buying_price?: number
          created_at?: string
          id?: string
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
          created_at: string
          id: string
          is_store_manager: boolean
          location: Database["public"]["Enums"]["location_type"] | null
          name: string
          role: Database["public"]["Enums"]["user_role"]
          staff_code: string
        }
        Insert: {
          created_at?: string
          id: string
          is_store_manager?: boolean
          location?: Database["public"]["Enums"]["location_type"] | null
          name: string
          role?: Database["public"]["Enums"]["user_role"]
          staff_code: string
        }
        Update: {
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
      canteen_supplied_total: {
        Args: { p_item_id: string; p_week_end: string; p_week_start: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
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
      recalculate_stock_entry: {
        Args: {
          p_entry_date: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
        }
        Returns: undefined
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
      save_stock_entry: {
        Args: {
          p_added_stock: number
          p_buying_price_snapshot: number
          p_created_by: string
          p_entry_date: string
          p_item_id: string
          p_location: Database["public"]["Enums"]["location_type"]
          p_selling_price_snapshot: number
          p_sent_out: number
          p_till_quantity_sold: number
          p_wastage: number
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

